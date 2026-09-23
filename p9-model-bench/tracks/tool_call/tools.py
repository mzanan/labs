"""Tool schemas for track 1, in Anthropic's input_schema shape, trimmed from p7's full
shopping-agent tool registry (upstream/shopping-agent/core/shopping_agent/tools/registry.py) to
the subset the 7 scenarios exercise: catalog, cart, order, policy reads/writes plus the two
presentation tools the grader inspects (present_products, present_comparison), and log_meal for
the approval_gate scenario, written in the fit-coach style (a single write tool behind an
approval step). translate_to_openai converts the same list to OpenAI's chat-completions
tool shape for the OpenRouter models, once, in code."""

from __future__ import annotations

from typing import Any

SHOPPING_TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_products",
        "description": (
            "Search the catalog; returns products with id, title, price, and availability. "
            "Use a specific query and put stated constraints in filters."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to look for, in the catalog's vocabulary."},
                "filters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "min_price": {"type": "number"},
                        "max_price": {"type": "number"},
                        "sort": {"type": "string", "enum": ["relevance", "price_asc", "price_desc"]},
                    },
                    "additionalProperties": False,
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_product_details",
        "description": "Full details for one product_id: description, price, stock.",
        "input_schema": {
            "type": "object",
            "properties": {"product_id": {"type": "string"}},
            "required": ["product_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_cart",
        "description": "Current cart contents with quantities and subtotal.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "add_to_cart",
        "description": "Add a product_id from a search or details result to the cart; quantity defaults to 1.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string"},
                "quantity": {"type": "integer", "minimum": 1},
            },
            "required": ["product_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_cart_item",
        "description": "Set the quantity of a product_id already in the cart.",
        "input_schema": {
            "type": "object",
            "properties": {"product_id": {"type": "string"}, "quantity": {"type": "integer", "minimum": 1}},
            "required": ["product_id", "quantity"],
            "additionalProperties": False,
        },
    },
    {
        "name": "remove_from_cart",
        "description": "Remove a product_id from the cart.",
        "input_schema": {
            "type": "object",
            "properties": {"product_id": {"type": "string"}},
            "required": ["product_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_order",
        "description": "Status, items and total for one order_id the customer named.",
        "input_schema": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "search_policies",
        "description": "Search the store's own terms and help content: returns, shipping, warranties, fees.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "present_products",
        "description": "Show products from this session's results to the customer, recommended pick first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "picks": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {"product_id": {"type": "string"}, "reason": {"type": "string"}},
                        "required": ["product_id"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["picks"],
            "additionalProperties": False,
        },
    },
    {
        "name": "present_comparison",
        "description": "Compare 2-4 finalists side by side and state which you recommend.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entries": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "properties": {"product_id": {"type": "string"}, "best_for": {"type": "string"}},
                        "required": ["product_id"],
                        "additionalProperties": False,
                    },
                },
                "recommended_product_id": {"type": "string"},
            },
            "required": ["entries"],
            "additionalProperties": False,
        },
    },
]

MEAL_LOG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "log_meal",
        "description": (
            "Log one meal with its macro estimate. This is a write and requires the user's approval "
            "before it takes effect; call it once per meal named, never twice for the same meal."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "What was eaten, e.g. 'chicken' or 'teriyaki'."},
                "macros": {
                    "type": "object",
                    "properties": {
                        "calories": {"type": "number"},
                        "protein_g": {"type": "number"},
                        "carbs_g": {"type": "number"},
                        "fat_g": {"type": "number"},
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["name"],
            "additionalProperties": False,
        },
    }
]


def translate_to_openai(anthropic_tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"],
            },
        }
        for tool in anthropic_tools
    ]
