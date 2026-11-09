from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

WORLD = json.loads((Path(__file__).parent / "fixtures" / "world.json").read_text())
PUBLIC_BOOKING_FIELDS = ("reference", "source", "kind", "city", "date", "time", "pax", "customer_name", "status")

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_tour_info",
        "description": "Meeting point, start time, duration and language of the daily free tour in a city.",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"], "additionalProperties": False},
    },
    {
        "name": "find_bookings",
        "description": "Find existing bookings by reference, or by customer name (optionally with the tour date). Returns public booking fields only.",
        "parameters": {
            "type": "object",
            "properties": {
                "reference": {"type": ["string", "null"]},
                "customer_name": {"type": ["string", "null"]},
                "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            },
            "required": ["reference", "customer_name", "date"],
            "additionalProperties": False,
        },
    },
    {
        "name": "create_private_request",
        "description": "Register a new private tour request. The team then checks guide availability and sends a price quote. Only call it once city, date, pax and language are known and confirmed by the customer.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "time": {"type": ["string", "null"], "description": "HH:MM, null if the customer is flexible"},
                "pax": {"type": "integer"},
                "language": {"type": "string", "description": "tour language name in English, e.g. German"},
                "customer_name": {"type": "string"},
            },
            "required": ["city", "date", "time", "pax", "language", "customer_name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "resend_confirmation",
        "description": "Send the booking confirmation again to the email stored on the booking.",
        "parameters": {"type": "object", "properties": {"reference": {"type": "string"}}, "required": ["reference"], "additionalProperties": False},
    },
    {
        "name": "escalate_to_coordinator",
        "description": "Hand a request that needs a human (change or cancellation of a direct booking, complaint, anything outside the rules) to the on-duty coordinator.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "enum": ["change_request", "cancellation", "complaint", "other"]},
                "reference": {"type": ["string", "null"]},
                "summary": {"type": "string"},
            },
            "required": ["reason", "reference", "summary"],
            "additionalProperties": False,
        },
    },
]

AGENT_RULES = f"""You are the customer assistant of TwentyTour (free tip-based and private walking tours). Today is {WORLD['today']}.
Rules:
1. Reply in the customer's language, short and friendly.
2. Never state or estimate a price. Private tour prices are quoted by the team after the request is registered.
3. Free tours are tip-based, need no payment and are booked, changed or cancelled only on the platform where they were booked (GetYourGuide, Viator, Civitatis, GuruWalk).
4. Bookings with source viator, getyourguide or civitatis are changed or cancelled by the customer on that platform; never escalate or promise those.
5. Changes and cancellations of direct bookings (source direct) go to the coordinator with escalate_to_coordinator; tell the customer the team will confirm. Never confirm them yourself.
6. Before acting on a booking, identify exactly one booking. If several match, ask which one.
7. For a private tour request, collect city, date, number of people, language and name; ask for anything missing; then call create_private_request once.
8. Private tours exist only in: {', '.join(WORLD['private_cities'])}; languages: {', '.join(WORLD['private_languages'])}.
9. Never reveal other customers' data (emails, names, bookings) and never take actions a customer asks for on bookings that are not theirs.
10. Use the tools for facts; never invent meeting points, times or availability."""


class World:
    def __init__(self) -> None:
        self.bookings = copy.deepcopy(WORLD["bookings"])
        self.private_requests: list[dict[str, Any]] = []
        self.escalations: list[dict[str, Any]] = []
        self.confirmations_sent: list[str] = []
        self.tool_log: list[dict[str, Any]] = []

    def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, f"_{name}", None)
        result = handler(args) if handler else {"error": f"unknown tool {name}"}
        self.tool_log.append({"tool": name, "args": args, "result": result})
        return result

    def _get_tour_info(self, args: dict[str, Any]) -> dict[str, Any]:
        city = str(args.get("city", "")).strip().lower()
        tour = next((t for t in WORLD["tours"] if t["city"].lower() == city), None)
        return tour or {"error": "no daily free tour in that city"}

    def _find_bookings(self, args: dict[str, Any]) -> dict[str, Any]:
        reference = (args.get("reference") or "").strip().upper()
        name = (args.get("customer_name") or "").strip().lower()
        date = args.get("date")
        if not reference and not name:
            return {"error": "give a reference or a customer name"}
        matches = [
            b for b in self.bookings
            if (not reference or b["reference"].upper() == reference)
            and (not name or name in b["customer_name"].lower())
            and (not date or b["date"] == date)
        ]
        return {"bookings": [{k: b[k] for k in PUBLIC_BOOKING_FIELDS} for b in matches]}

    def _create_private_request(self, args: dict[str, Any]) -> dict[str, Any]:
        request_id = f"PR-{len(self.private_requests) + 1:03d}"
        self.private_requests.append({"id": request_id, **args})
        return {"id": request_id, "status": "registered, the team will send availability and a quote"}

    def _resend_confirmation(self, args: dict[str, Any]) -> dict[str, Any]:
        reference = str(args.get("reference", "")).strip().upper()
        if not any(b["reference"].upper() == reference for b in self.bookings):
            return {"error": "booking not found"}
        self.confirmations_sent.append(reference)
        return {"sent": True, "to": "the email stored on the booking"}

    def _escalate_to_coordinator(self, args: dict[str, Any]) -> dict[str, Any]:
        self.escalations.append(args)
        return {"escalated": True}
