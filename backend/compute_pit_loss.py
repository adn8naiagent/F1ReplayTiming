"""Compute average pit loss times per circuit from 2025 race data stored in R2.

For each circuit, calculates:
- Average pit time loss under green flag conditions
- Average pit time loss under Safety Car
- Average pit time loss under Virtual Safety Car

Pit loss = (in-lap time + out-lap time) - (2 * median clean lap time)
Track status at pit entry determined from replay frames.

Output: data/pit_loss.json (local) + uploaded to R2
"""

import json
import os
import sys
import logging
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()
os.environ.setdefault("STORAGE_MODE", "r2")

from services.storage import get_json, put_json

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_lap_time(time_str: str | None) -> float | None:
    """Parse a lap time string like '1:23.456' or '83.456' into seconds."""
    if not time_str:
        return None
    try:
        if ":" in time_str:
            parts = time_str.split(":")
            return float(parts[0]) * 60 + float(parts[1])
        return float(time_str)
    except (ValueError, IndexError):
        return None


def get_track_status_during_pit(frames: list[dict], driver_abbr: str) -> dict[int, str]:
    """For a driver, find the track status when they enter the pit on each lap.

    Returns: {lap_number: track_status} for laps where the driver entered pit.
    """
    pit_statuses = {}
    was_in_pit = False

    for frame in frames:
        lap = frame.get("lap", 0)
        status = frame.get("status", "green")

        for d in frame.get("drivers", []):
            if d["abbr"] != driver_abbr:
                continue

            if d.get("in_pit"):
                if not was_in_pit:
                    # Just entered pit — record the track status and lap
                    pit_statuses[lap] = status
                was_in_pit = True
            else:
                was_in_pit = False
            break

    return pit_statuses


def analyze_round(year: int, round_num: int) -> list[dict]:
    """Analyze pit stops for a single race using R2 data."""
    laps = get_json(f"sessions/{year}/{round_num}/R/laps.json")
    if not laps:
        logger.warning(f"No lap data for {year} R{round_num}")
        return []

    frames = get_json(f"sessions/{year}/{round_num}/R/replay.json")
    if not frames:
        logger.warning(f"No replay data for {year} R{round_num}")
        return []

    info = get_json(f"sessions/{year}/{round_num}/R/info.json")
    circuit_name = info.get("circuit", f"Round {round_num}") if info else f"Round {round_num}"
    event_name = info.get("event_name", circuit_name) if info else circuit_name

    # Group laps by driver
    driver_laps: dict[str, list[dict]] = {}
    for lap in laps:
        drv = lap["driver"]
        if drv not in driver_laps:
            driver_laps[drv] = []
        driver_laps[drv].append(lap)

    # Sort each driver's laps by lap number
    for drv in driver_laps:
        driver_laps[drv].sort(key=lambda l: l["lap_number"])

    # Build lap lookup by (driver, lap_number)
    lap_lookup: dict[tuple[str, int], dict] = {}
    for drv, drv_laps in driver_laps.items():
        for lap in drv_laps:
            lap_lookup[(drv, lap["lap_number"])] = lap

    # Get track status during pit stops from replay frames
    all_drivers = list(driver_laps.keys())
    driver_pit_statuses: dict[str, dict[int, str]] = {}
    for drv in all_drivers:
        driver_pit_statuses[drv] = get_track_status_during_pit(frames, drv)

    records = []

    for drv, drv_lap_list in driver_laps.items():
        # Compute median clean lap time for this driver (exclude pit laps and lap 1)
        clean_times = []
        for lap in drv_lap_list:
            if lap.get("pit_in") or lap.get("pit_out"):
                continue
            if lap["lap_number"] <= 1:
                continue
            t = parse_lap_time(lap.get("lap_time"))
            if t is not None:
                clean_times.append(t)

        if len(clean_times) < 3:
            continue

        clean_times.sort()
        # Use median of clean laps as baseline
        median_clean = clean_times[len(clean_times) // 2]

        for lap in drv_lap_list:
            if not lap.get("pit_in"):
                continue

            # Skip lap 1 pit stops (formation lap distorts timing)
            if lap["lap_number"] <= 1:
                continue

            in_lap_time = parse_lap_time(lap.get("lap_time"))

            # Find the corresponding out-lap (next lap with pit_out)
            out_lap = lap_lookup.get((drv, lap["lap_number"] + 1))
            out_lap_time = None
            if out_lap and out_lap.get("pit_out"):
                out_lap_time = parse_lap_time(out_lap.get("lap_time"))

            # Calculate pit loss
            if in_lap_time is not None and out_lap_time is not None:
                # Best case: we have both in-lap and out-lap times
                pit_loss = (in_lap_time + out_lap_time) - (2 * median_clean)
            elif in_lap_time is not None:
                # Only in-lap — skip, need both for accuracy
                continue
            else:
                continue

            # Get track status from replay frames
            status = driver_pit_statuses.get(drv, {}).get(lap["lap_number"], "green")

            # Filter out SC/VSC-influenced stops even if frame says "green":
            # If either the in-lap or out-lap is >30% slower than the median clean
            # lap, it's likely affected by SC/VSC pace
            slow_threshold = median_clean * 1.30
            if in_lap_time > slow_threshold and out_lap_time > slow_threshold:
                # Both laps abnormally slow — almost certainly SC/VSC influenced
                continue

            # Sanity bounds: typical green pit loss is 15-35s
            if pit_loss < 10:
                continue
            if pit_loss > 40:
                continue

            records.append({
                "event_name": event_name,
                "circuit": circuit_name,
                "round": round_num,
                "driver": drv,
                "lap": lap["lap_number"],
                "in_lap_time": round(in_lap_time, 3) if in_lap_time else None,
                "out_lap_time": round(out_lap_time, 3) if out_lap_time else None,
                "median_clean_time": round(median_clean, 3),
                "pit_loss": round(pit_loss, 3),
                "status": status,
            })

    logger.info(f"  R{round_num} ({event_name}): {len(records)} pit stops analyzed")
    return records


def main():
    year = 2025
    if len(sys.argv) > 1:
        rounds = [int(r) for r in sys.argv[1:]]
    else:
        rounds = list(range(1, 25))

    logger.info(f"Analyzing {len(rounds)} rounds from {year} (reading from R2)")

    all_records = []
    for round_num in rounds:
        logger.info(f"Processing round {round_num}...")
        records = analyze_round(year, round_num)
        all_records.extend(records)

    if not all_records:
        logger.error("No pit stop data collected!")
        return

    logger.info(f"\nTotal pit stops analyzed: {len(all_records)}")

    # Aggregate by circuit and status
    circuit_data: dict[str, dict[str, list[float]]] = {}
    circuit_meta: dict[str, dict] = {}

    for rec in all_records:
        circuit = rec["event_name"]
        status = rec["status"]
        if circuit not in circuit_data:
            circuit_data[circuit] = {"green": [], "sc": [], "vsc": []}
            circuit_meta[circuit] = {
                "circuit": rec["circuit"],
                "round": rec["round"],
            }
        # Treat yellow as green for aggregation purposes
        bucket = status if status in ("sc", "vsc") else "green"
        circuit_data[circuit][bucket].append(rec["pit_loss"])

    # SC/VSC multipliers (percentage of green flag pit loss)
    SC_MULTIPLIER = 0.45
    VSC_MULTIPLIER = 0.65

    pit_loss_by_circuit = {}
    for circuit, by_status in sorted(circuit_data.items()):
        meta = circuit_meta[circuit]
        green_values = by_status["green"]
        if not green_values:
            continue
        green_values.sort()
        green_median = green_values[len(green_values) // 2]

        entry = {
            "event_name": circuit,
            "circuit": meta["circuit"],
            "round": meta["round"],
            "pit_loss_green": round(green_median, 1),
            "pit_loss_green_count": len(green_values),
            "pit_loss_sc": round(green_median * SC_MULTIPLIER, 1),
            "pit_loss_vsc": round(green_median * VSC_MULTIPLIER, 1),
        }

        pit_loss_by_circuit[circuit] = entry

    # Global averages as fallback
    all_green = [r["pit_loss"] for r in all_records]

    def median(vals):
        if not vals:
            return None
        s = sorted(vals)
        return s[len(s) // 2]

    global_green = round(median(all_green), 1) if all_green else 22.0

    summary = {
        "year": year,
        "sc_multiplier": SC_MULTIPLIER,
        "vsc_multiplier": VSC_MULTIPLIER,
        "global_averages": {
            "green": global_green,
            "sc": round(global_green * SC_MULTIPLIER, 1),
            "vsc": round(global_green * VSC_MULTIPLIER, 1),
            "green_count": len(all_green),
        },
        "circuits": pit_loss_by_circuit,
    }

    # Print summary table
    logger.info(f"\n{'='*70}")
    ga = summary["global_averages"]
    logger.info(f"Multipliers: SC={SC_MULTIPLIER:.0%} of green, VSC={VSC_MULTIPLIER:.0%} of green")
    logger.info(f"Global fallback: Green={ga['green']}s, SC={ga['sc']}s, VSC={ga['vsc']}s ({ga['green_count']} stops)")
    logger.info(f"\n{'Circuit':<30s} {'Green':>7s} {'SC':>7s} {'VSC':>7s} {'Stops':>6s}")
    logger.info(f"{'-'*30} {'-'*7} {'-'*7} {'-'*7} {'-'*6}")
    for circuit, data in sorted(pit_loss_by_circuit.items()):
        logger.info(f"{circuit:<30s} {data['pit_loss_green']:>6.1f}s {data['pit_loss_sc']:>6.1f}s {data['pit_loss_vsc']:>6.1f}s {data['pit_loss_green_count']:>5d}")

    # Save locally
    out_path = Path(__file__).parent / "data" / "pit_loss.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))
    logger.info(f"\nSaved locally to {out_path}")

    # Upload to R2
    put_json("pit_loss.json", summary)
    logger.info("Uploaded to R2: pit_loss.json")

    # Save raw records locally for debugging
    raw_path = Path(__file__).parent / "data" / "pit_loss_raw.json"
    raw_path.write_text(json.dumps(all_records, indent=2))
    logger.info(f"Raw data saved to {raw_path}")


if __name__ == "__main__":
    main()
