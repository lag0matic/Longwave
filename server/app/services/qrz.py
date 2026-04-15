from collections.abc import Iterable
from urllib.parse import parse_qs
from xml.etree import ElementTree

import httpx

from ..config import Settings
from ..schemas import CallsignLookupResult, QrzUploadResponse


class QrzService:
    _session_cache: dict[str, str] = {}

    def __init__(
        self,
        settings: Settings,
        *,
        username: str | None = None,
        password: str | None = None,
        api_key: str | None = None,
    ):
        self.settings = settings
        self.username = username or settings.qrz_username
        self.password = password or settings.qrz_password
        self.api_key = api_key or settings.qrz_api_key
        self.user_agent = "Longwave/0.1 (ham radio logging)"

    async def _xml_request(self, params: dict[str, str]) -> ElementTree.Element:
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": self.user_agent}) as client:
            response = await client.get(self.settings.qrz_xml_url, params=params)
            response.raise_for_status()
        return ElementTree.fromstring(response.text)

    def _iter_elements(self, root: ElementTree.Element) -> Iterable[ElementTree.Element]:
        yield root
        yield from root.iter()

    def _local_name(self, tag: str) -> str:
        return tag.rsplit("}", 1)[-1] if "}" in tag else tag

    def _find_first(self, root: ElementTree.Element, name: str) -> ElementTree.Element | None:
        target = name.lower()
        for element in self._iter_elements(root):
            if self._local_name(element.tag).lower() == target:
                return element
        return None

    def _find_text(self, node: ElementTree.Element | None, name: str) -> str | None:
        if node is None:
            return None
        child = self._find_first(node, name)
        if child is None or child.text is None:
            return None
        value = child.text.strip()
        return value or None

    def _session_error(self, root: ElementTree.Element) -> str | None:
        session = self._find_first(root, "Session")
        if session is None:
            return "QRZ session response was missing."
        error = self._find_text(session, "Error")
        return error.strip() if error else None

    def _session_key(self, root: ElementTree.Element) -> str | None:
        session = self._find_first(root, "Session")
        if session is None:
            return None
        return self._find_text(session, "Key")

    async def _login(self) -> str:
        if not self.username or not self.password:
            raise RuntimeError("QRZ XML lookup is not configured. Set QRZ username and password on the server.")

        cache_key = self.username.upper()
        cached = self._session_cache.get(cache_key)
        if cached:
            return cached

        root = await self._xml_request(
            {
                "username": self.username,
                "password": self.password,
                "agent": self.user_agent,
            }
        )
        error = self._session_error(root)
        if error:
            raise RuntimeError(f"QRZ login failed: {error}")

        key = self._session_key(root)
        if not key:
            raise RuntimeError("QRZ login did not return a session key.")

        self._session_cache[cache_key] = key
        return key

    async def _lookup_with_session(self, session_key: str, callsign: str) -> ElementTree.Element:
        return await self._xml_request(
            {
                "s": session_key,
                "callsign": callsign,
            }
        )

    async def lookup_callsign(self, callsign: str) -> CallsignLookupResult:
        normalized = callsign.upper().strip()
        session_key = await self._login()
        root = await self._lookup_with_session(session_key, normalized)

        error = self._session_error(root)
        if error:
            if "session" in error.lower():
                self._session_cache.pop((self.username or "").upper(), None)
                session_key = await self._login()
                root = await self._lookup_with_session(session_key, normalized)
                error = self._session_error(root)
            if error:
                raise RuntimeError(f"QRZ lookup failed: {error}")

        callsign_node = self._find_first(root, "Callsign")
        if callsign_node is None:
            raise RuntimeError(f"QRZ did not return callsign data for {normalized}.")

        name_parts = [self._find_text(callsign_node, "fname"), self._find_text(callsign_node, "name")]
        full_name = " ".join(part.strip() for part in name_parts if part and part.strip()) or None

        lat = self._find_text(callsign_node, "lat")
        lon = self._find_text(callsign_node, "lon")

        return CallsignLookupResult(
            callsign=(self._find_text(callsign_node, "call") or normalized).upper(),
            name=full_name,
            qth=self._find_text(callsign_node, "addr2"),
            county=self._find_text(callsign_node, "county"),
            grid_square=self._find_text(callsign_node, "grid"),
            country=self._find_text(callsign_node, "country"),
            state=self._find_text(callsign_node, "state"),
            dxcc=self._find_text(callsign_node, "dxcc"),
            lat=float(lat) if lat else None,
            lon=float(lon) if lon else None,
            qrz_url=self._find_text(callsign_node, "url") or f"https://www.qrz.com/db/{normalized}",
        )

    async def upload_adif(self, logbook_id: str, adif_text: str) -> QrzUploadResponse:
        if not self.api_key:
            return QrzUploadResponse(
                logbook_id=logbook_id,
                uploaded=False,
                message="QRZ logbook API key is not configured on the server.",
            )

        payload = {
            "KEY": self.api_key,
            "ACTION": "INSERT",
            "ADIF": self._extract_adif_records(adif_text),
        }

        async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": self.user_agent}) as client:
            response = await client.post(self.settings.qrz_logbook_api_url, data=payload)
            response.raise_for_status()

        parsed = self._parse_logbook_response(response.text)
        result = parsed.get("RESULT", ["FAIL"])[0]
        if result != "OK":
            message = parsed.get("REASON", parsed.get("ERROR", ["QRZ upload failed."]))[0]
            return QrzUploadResponse(logbook_id=logbook_id, uploaded=False, message=message)

        count = parsed.get("COUNT", ["0"])[0]
        logids = parsed.get("LOGIDS", [""])[0]
        return QrzUploadResponse(
            logbook_id=logbook_id,
            uploaded=True,
            message=f"Uploaded {count} QSO(s) to QRZ. Log IDs: {logids}",
        )

    def _extract_adif_records(self, adif_text: str) -> str:
        marker = "<EOH>"
        if marker in adif_text:
            return adif_text.split(marker, 1)[1].strip()
        return adif_text.strip()

    def _parse_logbook_response(self, body: str) -> dict[str, list[str]]:
        return parse_qs(body.strip(), keep_blank_values=True)
