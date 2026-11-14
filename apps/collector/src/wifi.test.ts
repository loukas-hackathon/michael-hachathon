import assert from "node:assert/strict";
import { test } from "node:test";
import { networkId, parseAirport, parseArp, parseRoute } from "./wifi";

// Output shapes as macOS prints them, with made up addresses.

test("route: gateway and interface", () => {
  const out = `   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>`;
  assert.deepEqual(parseRoute(out), { gateway: "192.168.1.1", iface: "en0" });
  assert.equal(parseRoute("route: writing to routing socket: not in table"), null);
});

test("arp: the hardware address, padded", () => {
  assert.equal(parseArp("? (192.168.1.1) at a4:5e:6:b:c1:d2 on en0 ifscope [ethernet]"), "a4:5e:06:0b:c1:d2");
  assert.equal(parseArp("? (192.168.1.1) at (incomplete) on en0 ifscope [ethernet]"), null);
});

test("airport: the name, unless redacted or not on Wi-Fi", () => {
  assert.equal(parseAirport("Current Wi-Fi Network: Office 5G\n"), "Office 5G");
  assert.equal(parseAirport("You are not associated with an AirPort network.\n"), null);
  assert.equal(parseAirport("Current Wi-Fi Network: <redacted>"), null);
});

test("network id: stable, short, says nothing", () => {
  assert.equal(networkId("a4:5e:06:0b:c1:d2"), networkId("a4:5e:06:0b:c1:d2"));
  assert.equal(networkId("x").length, 16);
  assert.notEqual(networkId("a"), networkId("b"));
});
