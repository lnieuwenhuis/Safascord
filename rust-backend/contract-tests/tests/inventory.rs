#[test]
fn contract_inventory_is_checked_in() {
    let openapi = include_str!("../../docs/openapi.yaml");
    let ws = include_str!("../../docs/websocket-protocol.md");
    assert!(openapi.contains("/api/messages"));
    assert!(ws.contains("\"type\": \"message\""));
}
