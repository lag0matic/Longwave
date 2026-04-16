from datetime import UTC, datetime

import httpx

from ..config import Settings
from ..models import Spot
from ..schemas import SpotCreateRequest


def parse_spot_time(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)

    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
      return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def derive_band(frequency_khz: float) -> str:
    if 1800 <= frequency_khz < 2000:
        return "160m"
    if 3500 <= frequency_khz < 4000:
        return "80m"
    if 7000 <= frequency_khz < 7300:
        return "40m"
    if 10100 <= frequency_khz < 10150:
        return "30m"
    if 14000 <= frequency_khz < 14350:
        return "20m"
    if 18068 <= frequency_khz < 18168:
        return "17m"
    if 21000 <= frequency_khz < 21450:
        return "15m"
    if 24890 <= frequency_khz < 24990:
        return "12m"
    if 28000 <= frequency_khz < 29700:
        return "10m"
    if 50000 <= frequency_khz < 54000:
        return "6m"
    return "HF"


def normalize_callsign(value: str | None) -> str | None:
    return value.strip().upper() if value else None


class PotaService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.settings.pota_api_key:
            headers["X-Api-Key"] = self.settings.pota_api_key
        return headers

    def _map_spot(self, payload: dict) -> Spot:
        frequency_khz = float(payload["frequency"])
        return Spot(
            id=f"pota-{payload.get('spotId', payload.get('activator', 'spot'))}",
            activator_callsign=normalize_callsign(payload.get("activator")) or "UNKNOWN",
            park_reference=payload.get("reference", "UNKNOWN"),
            frequency_khz=frequency_khz,
            mode=(payload.get("mode") or "SSB").upper(),
            band=derive_band(frequency_khz),
            comments=payload.get("comments") or payload.get("name") or payload.get("parkName"),
            spotter_callsign=normalize_callsign(payload.get("spotter")),
            spotted_at=parse_spot_time(payload.get("spotTime")),
            lat=payload.get("latitude"),
            lon=payload.get("longitude"),
        )

    async def fetch_spots(self) -> list[Spot]:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(self.settings.pota_spots_url, headers=self._headers())
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as error:
            detail = error.response.text.strip() or str(error)
            raise RuntimeError(f"POTA spot fetch failed: {detail}") from error
        except httpx.RequestError as error:
            raise RuntimeError(f"POTA spot fetch failed: {error}") from error

        spots = [self._map_spot(entry) for entry in payload if not entry.get("invalid")]
        spots.sort(key=lambda spot: spot.spotted_at, reverse=True)
        return spots

    async def create_spot(self, request: SpotCreateRequest) -> Spot:
        payload = {
            "activator": request.activator_callsign.upper(),
            "reference": request.park_reference.upper(),
            "frequency": f"{request.frequency_khz:.1f}",
            "mode": request.mode.upper(),
            "spotter": normalize_callsign(request.spotter_callsign) or request.activator_callsign.upper(),
            "comments": request.comments or "",
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self.settings.pota_spot_post_url,
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json=payload,
                )
                response.raise_for_status()

                if "application/json" in response.headers.get("content-type", ""):
                    body = response.json()
                    if isinstance(body, dict) and body:
                        body.setdefault("activator", payload["activator"])
                        body.setdefault("reference", payload["reference"])
                        body.setdefault("frequency", payload["frequency"])
                        body.setdefault("mode", payload["mode"])
                        body.setdefault("spotter", payload["spotter"])
                        body.setdefault("comments", payload["comments"])
                        return self._map_spot(body)
        except httpx.HTTPStatusError as error:
            detail = error.response.text.strip() or str(error)
            raise RuntimeError(f"POTA spot post failed: {detail}") from error
        except httpx.RequestError as error:
            raise RuntimeError(f"POTA spot post failed: {error}") from error

        return Spot(
            activator_callsign=payload["activator"],
            park_reference=payload["reference"],
            frequency_khz=request.frequency_khz,
            mode=payload["mode"],
            band=request.band,
            comments=payload["comments"],
            spotter_callsign=payload["spotter"],
        )
