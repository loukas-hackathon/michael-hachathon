import assert from "node:assert/strict";
import { test } from "node:test";
import { isMapsUrl, parseMapsUrl, titleHasPosition } from "./maps-url";

// Address shapes copied from real Chrome history, with places swapped for public landmarks.

const term = (url: string) => parseMapsUrl(url)?.term ?? null;

test("search: keeps the words, drops the map position and data blob", () => {
  const url =
    "https://www.google.com/maps/search/gyms+near+me/@38.7412,22.3501,4693m/data=!3m1!1e3?entry=ttu&g_ep=EgoyMDI2";
  const hit = parseMapsUrl(url);
  assert.equal(hit?.term, "gyms near me");
  assert.deepEqual(hit?.maps, {
    kind: "search",
    place: { name: "gyms near me", lat: null, lng: null },
    from: null,
    to: null,
  });
  assert.ok(!hit?.term.includes("@"));
});

test("search: URL encoded text, Greek, plus signs and %2B", () => {
  assert.equal(
    term(
      "https://www.google.gr/maps/search/%CE%B3%CF%85%CE%BC%CE%BD%CE%B1%CF%83%CF%84%CE%AE%CF%81%CE%B9%CE%BF/@37.98,23.72,15z",
    ),
    "γυμναστήριο",
  );
  assert.equal(term("https://www.google.com/maps/search/coffee%20shop+Koukaki/"), "coffee shop Koukaki");
  assert.equal(term("https://www.google.com/maps/search/C%2B%2B+meetup"), "C++ meetup");
  assert.equal(term("https://www.google.com/maps/search/Odos+Ermou%2F10"), "Odos Ermou/10");
});

test("search: api=1 and ?q= forms", () => {
  assert.equal(term("https://www.google.com/maps/search/?api=1&query=Acropolis+Museum"), "Acropolis Museum");
  assert.equal(term("https://www.google.com/maps?q=Syntagma+Square&hl=en"), "Syntagma Square");
  assert.equal(term("https://maps.google.com/?q=pharmacy+open+now"), "pharmacy open now");
  assert.equal(term("https://maps.google.gr/maps?q=Kifisia&um=1&ie=UTF-8"), "Kifisia");
});

test("search for a bare position is a dropped pin with coordinates, never a term", () => {
  const hit = parseMapsUrl("https://www.google.com/maps/search/37.9715,+23.7257?entry=tts");
  assert.equal(hit?.term, "Dropped pin");
  assert.deepEqual(hit?.maps.place, { name: null, lat: 37.9715, lng: 23.7257 });
  assert.equal(parseMapsUrl("https://www.google.com/maps?q=37.9715,23.7257")?.maps.kind, "place");
});

test("place: name from the path, exact coordinates from the data blob", () => {
  const url =
    "https://www.google.com/maps/place/Acropolis+Museum/@37.968,23.7262,17z/data=!3m1!4b1!4m6!3m5!1s0x14a1bd1837b0c2a3:0x6b3f2a!8m2!3d37.9684499!4d23.7285227!16s%2Fm%2F02q4n0w?entry=ttu";
  const hit = parseMapsUrl(url);
  assert.equal(hit?.term, "Acropolis Museum");
  assert.deepEqual(hit?.maps, {
    kind: "place",
    place: { name: "Acropolis Museum", lat: 37.9684499, lng: 23.7285227 },
    from: null,
    to: null,
  });
});

test("place: falls back to the map position when there is no data blob", () => {
  const hit = parseMapsUrl("https://www.google.com/maps/place/Lycabettus+Hill/@37.9819,23.7433,16z");
  assert.deepEqual(hit?.maps.place, { name: "Lycabettus Hill", lat: 37.9819, lng: 23.7433 });
});

test("place: an address with commas and a postcode stays the name", () => {
  const hit = parseMapsUrl(
    "https://www.google.com/maps/place/Ermou+10,+Athina+105+63,+Greece/@37.9761,23.7302,17z/data=!3m1!4b1",
  );
  assert.equal(hit?.term, "Ermou 10, Athina 105 63, Greece");
});

test("place: a written out position is a dropped pin", () => {
  const hit = parseMapsUrl(
    "https://www.google.com/maps/place/37%C2%B058'17.4%22N+23%C2%B043'32.5%22E/@37.9715,23.7257,17z/data=!3m1!4b1!4m4!3m3!8m2!3d37.9715!4d23.7257",
  );
  assert.equal(hit?.term, "Dropped pin");
  assert.deepEqual(hit?.maps.place, { name: null, lat: 37.9715, lng: 23.7257 });
});

test("place: a place id with no name is left out", () => {
  assert.equal(
    parseMapsUrl("https://www.google.com/maps/place/?q=place_id:ChIJ3S-JXmauEmsRUcIaWtf4MzE"),
    null,
  );
});

test("directions: origin and destination from the path", () => {
  const hit = parseMapsUrl(
    "https://www.google.com/maps/dir/Syntagma+Square,+Athens/Athens+International+Airport/@37.95,23.85,11z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x14a1bd3d!2m2!1d23.7348!2d37.9755!1m5!1m1!1s0x14a19!2m2!1d23.9484!2d37.9356!3e0",
  );
  assert.equal(hit?.term, "Syntagma Square, Athens to Athens International Airport");
  assert.deepEqual(hit?.maps, {
    kind: "directions",
    place: null,
    from: { name: "Syntagma Square, Athens", lat: null, lng: null },
    to: { name: "Athens International Airport", lat: null, lng: null },
  });
});

test("directions: from the current position keeps it as coordinates, not in the term", () => {
  const hit = parseMapsUrl("https://www.google.com/maps/dir/37.9838,23.7275/Piraeus+Port/@37.96,23.68,13z");
  assert.equal(hit?.term, "Directions to Piraeus Port");
  assert.deepEqual(hit?.maps.from, { name: null, lat: 37.9838, lng: 23.7275 });
});

test("directions: empty origin, waypoints, api=1 and the old saddr/daddr form", () => {
  assert.equal(term("https://www.google.com/maps/dir//Kifisia/@38.07,23.81,14z"), "Directions to Kifisia");
  assert.equal(term("https://www.google.com/maps/dir/Home/Gym/Office/"), "Home to Office");
  assert.equal(
    term("https://www.google.com/maps/dir/?api=1&origin=Glyfada&destination=Marousi&travelmode=driving"),
    "Glyfada to Marousi",
  );
  assert.equal(term("https://maps.google.com/maps?saddr=Pagrati&daddr=Kallithea"), "Pagrati to Kallithea");
  assert.equal(term("https://www.google.com/maps/dir/"), null);
});

test("not a search: bare map views, short links, other Google pages", () => {
  assert.equal(parseMapsUrl("https://www.google.com/maps/@37.9838,23.7275,14z"), null);
  assert.equal(parseMapsUrl("https://www.google.com/maps"), null);
  assert.equal(parseMapsUrl("https://maps.app.goo.gl/AbCdEfGh123"), null);
  assert.equal(parseMapsUrl("https://goo.gl/maps/AbCdEfGh123"), null);
  assert.equal(parseMapsUrl("https://www.google.com/search?q=maps"), null);
  assert.equal(parseMapsUrl("https://mapsgoogle.example.com/maps/search/x"), null);
  assert.equal(parseMapsUrl("not a url"), null);
  assert.equal(isMapsUrl("https://maps.app.goo.gl/AbCdEfGh123"), false);
  assert.equal(isMapsUrl("https://www.google.co.uk/maps/place/Big+Ben"), true);
  assert.equal(isMapsUrl("https://www.google.com/mapsearch"), false);
});

test("a broken escape is kept as written instead of throwing", () => {
  assert.equal(term("https://www.google.com/maps/search/100%25+juice%ZZ"), "100% juice%ZZ");
});

test("titles that carry a position are recognised", () => {
  assert.equal(titleHasPosition(`37°58'17.4"N 23°43'32.5"E - Google Maps`), true);
  assert.equal(titleHasPosition("37.97150, 23.72570 - Google Maps"), true);
  assert.equal(titleHasPosition("Acropolis Museum - Google Maps"), false);
});
