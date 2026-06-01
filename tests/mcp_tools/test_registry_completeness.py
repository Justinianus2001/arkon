"""
Guard: every MCP tool registered on the Arkon server must declare a
visibility requirement via @kb_tool.

If a future contributor adds a tool with raw `@mcp.tool()` and forgets the
visibility gate, this test fails and surfaces which tool slipped through.
The default `requirement_for(...)` fallback would otherwise hide the
oversight by treating the tool as ANY_AUTHENTICATED.
"""

import pytest

from app.mcp.permissions import REQUIRES_ATTR
from app.mcp.server import create_mcp_server


@pytest.mark.asyncio
async def test_every_tool_has_visibility_requirement():
    mcp = create_mcp_server()
    tools = list(await mcp.list_tools(run_middleware=False))

    assert tools, "Expected at least one tool to be registered"

    missing = [t.name for t in tools if not hasattr(t.fn, REQUIRES_ATTR)]
    assert not missing, (
        f"These tools were registered without a kb_tool visibility "
        f"requirement: {missing}. Use @kb_tool(mcp, requires=...) instead "
        f"of raw @mcp.tool() so ScopedToolsMiddleware can gate them "
        f"correctly. See app/mcp/permissions.py for the available tiers."
    )
