from fastapi import APIRouter, Query, HTTPException, Response
from app_config import set_cache, validate_driver, validate_session
from services.storage import aget_json

router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/sessions/{year}/{round_num}/telemetry")
async def driver_telemetry(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R"),
    driver: str = Query(...),
    lap: int = Query(...),
):
    validate_session(year, round_num, type)
    validate_driver(driver)
    data = await aget_json(f"sessions/{year}/{round_num}/{type}/telemetry/{driver}.json")
    if data is None:
        raise HTTPException(status_code=404, detail="Telemetry not available for this driver")

    lap_data = data.get(str(lap))
    if lap_data is None:
        raise HTTPException(status_code=404, detail="Telemetry not available for this lap")
    set_cache(response, 300)
    return lap_data
