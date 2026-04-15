from datetime import UTC, datetime
from collections.abc import Iterable

from ..db_models import AppSettingsRecord
from ..models import Contact, Logbook


def export_contacts_to_adif(
    contacts: Iterable[Contact],
    logbook: Logbook | None = None,
    app_settings: AppSettingsRecord | None = None,
) -> str:
    created_timestamp = datetime.now(UTC).strftime("%Y%m%d %H%M%S")
    header = (
        "<ADIF_VER:5>3.1.6\n"
        f"<CREATED_TIMESTAMP:{len(created_timestamp)}>{created_timestamp}\n"
        "<PROGRAMID:8>Longwave\n"
        "<PROGRAMVERSION:5>0.1.0\n"
        "<EOH>\n\n"
    )
    records: list[str] = []
    for contact in contacts:
        frequency_mhz = contact.frequency_khz / 1000
        band = contact.band or _band_from_frequency_khz(contact.frequency_khz)
        parts = [
        ]
        if contact.rst_recvd:
            parts.append(f"<RST_RCVD:{len(contact.rst_recvd)}>{contact.rst_recvd}")
        if contact.rst_sent:
            parts.append(f"<RST_SENT:{len(contact.rst_sent)}>{contact.rst_sent}")
        parts.extend([
            f"<CALL:{len(contact.station_callsign)}>{contact.station_callsign}",
            f"<OPERATOR:{len(contact.operator_callsign)}>{contact.operator_callsign}",
            f"<TIME_ON:{len(contact.time_on)}>{contact.time_on}",
            f"<QSO_DATE:{len(contact.qso_date)}>{contact.qso_date}",
            f"<FREQ:{len(str(frequency_mhz))}>{frequency_mhz}",
            f"<BAND:{len(band)}>{band}",
            f"<MODE:{len(contact.mode)}>{contact.mode}",
        ])
        tx_power = contact.tx_power or (app_settings.default_tx_power if app_settings else None)
        if tx_power:
            parts.append(f"<TX_PWR:{len(tx_power)}>{tx_power}")
        if app_settings and app_settings.my_grid_square:
            parts.append(f"<MY_GRIDSQUARE:{len(app_settings.my_grid_square)}>{app_settings.my_grid_square}")
        if app_settings and app_settings.my_state:
            parts.append(f"<MY_STATE:{len(app_settings.my_state)}>{app_settings.my_state}")
        if app_settings and app_settings.my_county:
            parts.append(f"<MY_CNTY:{len(app_settings.my_county)}>{app_settings.my_county}")
        if contact.park_reference:
            parts.append(f"<POTA_REF:{len(contact.park_reference)}>{contact.park_reference}")
        if contact.name:
            parts.append(f"<NAME:{len(contact.name)}>{contact.name}")
        if contact.state:
            parts.append(f"<STATE:{len(contact.state)}>{contact.state}")
        normalized_country = _normalize_country(contact.country)
        if normalized_country:
            parts.append(f"<COUNTRY:{len(normalized_country)}>{normalized_country}")
        if contact.grid_square:
            parts.append(f"<GRIDSQUARE:{len(contact.grid_square)}>{contact.grid_square}")
        if contact.qrz_upload_status:
            parts.append(f"<QRZCOM_QSO_UPLOAD_STATUS:{len(contact.qrz_upload_status)}>{contact.qrz_upload_status}")
        if contact.qrz_upload_date:
            parts.append(f"<QRZCOM_QSO_UPLOAD_DATE:{len(contact.qrz_upload_date)}>{contact.qrz_upload_date}")
        if contact.park_reference:
            parts.append("<SIG:4>POTA")
            parts.append(f"<SIG_INFO:{len(contact.park_reference)}>{contact.park_reference}")
        if contact.qth:
            parts.append(f"<QTH:{len(contact.qth)}>{contact.qth}")
        if contact.county:
            parts.append(f"<CNTY:{len(contact.county)}>{contact.county}")
        if logbook and logbook.park_reference:
            parts.append(f"<MY_POTA_REF:{len(logbook.park_reference)}>{logbook.park_reference}")
        if logbook and logbook.park_reference:
            parts.append("<MY_SIG:4>POTA")
            parts.append(f"<MY_SIG_INFO:{len(logbook.park_reference)}>{logbook.park_reference}")
        if contact.dxcc:
            parts.append(f"<DXCC:{len(contact.dxcc)}>{contact.dxcc}")
        record = "".join(parts) + "<EOR>\n"
        records.append(record)
    return header + "".join(records)


def _band_from_frequency_khz(frequency_khz: float) -> str:
    if 1800 <= frequency_khz < 2000:
        return "160m"
    if 3500 <= frequency_khz < 4000:
        return "80m"
    if 5330 <= frequency_khz < 5410:
        return "60m"
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
    if 144000 <= frequency_khz < 148000:
        return "2m"
    return ""


def import_adif_text(adif_text: str, logbook_id: str, operator_callsign: str) -> list[Contact]:
    contacts: list[Contact] = []
    normalized_adif = adif_text
    if "<EOH>" in normalized_adif.upper():
        split_index = normalized_adif.upper().find("<EOH>")
        normalized_adif = normalized_adif[split_index + len("<EOH>") :]

    for line in normalized_adif.split("<EOR>"):
        normalized = line.strip()
        if "<CALL:" not in normalized.upper():
            continue
        fields: dict[str, str] = {}
        remaining = normalized
        while "<" in remaining and ">" in remaining:
            start = remaining.find("<")
            mid = remaining.find(">", start)
            tag = remaining[start + 1 : mid]
            if ":" not in tag:
                remaining = remaining[mid + 1 :]
                continue
            key, length_text = tag.split(":", 1)
            key = key.upper()
            length = int(length_text.split(":", 1)[0])
            value = remaining[mid + 1 : mid + 1 + length]
            fields[key] = value
            remaining = remaining[mid + 1 + length :]

        band = fields.get("BAND") or _band_from_frequency_khz(_frequency_khz_from_adif(fields))
        imported_operator = fields.get("STATION_CALLSIGN") or fields.get("OPERATOR") or operator_callsign
        park_reference = fields.get("SIG_INFO") or fields.get("POTA_REF")

        contacts.append(
            Contact(
                logbook_id=logbook_id,
                operator_callsign=imported_operator,
                station_callsign=fields.get("CALL", ""),
                qso_date=fields.get("QSO_DATE", ""),
                time_on=fields.get("TIME_ON", ""),
                band=band,
                mode=fields.get("MODE", ""),
                frequency_khz=_frequency_khz_from_adif(fields),
                rst_sent=fields.get("RST_SENT"),
                rst_recvd=fields.get("RST_RCVD"),
                tx_power=fields.get("TX_PWR"),
                name=fields.get("NAME"),
                qth=fields.get("QTH"),
                county=fields.get("CNTY"),
                park_reference=park_reference,
                grid_square=fields.get("GRIDSQUARE"),
                state=fields.get("STATE"),
                country=fields.get("COUNTRY"),
                dxcc=fields.get("DXCC"),
                qrz_upload_status=fields.get("QRZCOM_QSO_UPLOAD_STATUS"),
                qrz_upload_date=fields.get("QRZCOM_QSO_UPLOAD_DATE"),
            )
        )
    return contacts


def _frequency_khz_from_adif(fields: dict[str, str]) -> float:
    frequency_text = fields.get("FREQ")
    if not frequency_text:
        return 0.0
    try:
        return float(frequency_text) * 1000
    except ValueError:
        return 0.0


def _normalize_country(country: str | None) -> str | None:
    if not country:
        return None

    normalized = country.strip()
    if not normalized:
        return None

    aliases = {
        "UNITED STATES": "UNITED STATES OF AMERICA",
        "USA": "UNITED STATES OF AMERICA",
        "U.S.A.": "UNITED STATES OF AMERICA",
    }
    return aliases.get(normalized.upper(), normalized.upper())
