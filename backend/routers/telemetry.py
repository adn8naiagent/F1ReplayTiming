from fastapi import APIRouter, Query, HTTPException
from services.f1_data import get_driver_telemetry

router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/sessions/{year}/{round_num}/telemetry")
async def driver_telemetry(
    year: int,
    round_num: int,
    type: str = Query("R"),
    driver: str = Query(...),
    lap: int = Query(...),
):
    data = await get_driver_telemetry(year, round_num, type, driver, lap)
    if data is None:
        raise HTTPException(status_code=404, detail="Telemetry not available for this driver/lap")
    return data
