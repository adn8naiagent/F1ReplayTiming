from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json

router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/sessions/{year}/{round_num}/telemetry")
async def driver_telemetry(
    year: int,
    round_num: int,
    type: str = Query("R"),
    driver: str = Query(...),
    lap: int = Query(...),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/telemetry/{driver}.json")
    if data is None:
        raise HTTPException(status_code=404, detail="Telemetry not available for this driver")

    lap_data = data.get(str(lap))
    if lap_data is None:
        raise HTTPException(status_code=404, detail="Telemetry not available for this lap")
    return lap_data
