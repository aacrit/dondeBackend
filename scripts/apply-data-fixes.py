#!/usr/bin/env python3
"""
Apply all data quality fixes via Supabase REST API.
Covers: existing migrations 000006-000014 + new fixes (000015).
Run: python3 scripts/apply-data-fixes.py
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

SUPAB_URL = "https://vwbzkgsxmgwcvmvuxnbe.supabase.co"
SUPAB_KEY = os.environ.get("SUPAB_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTk2NTM1NiwiZXhwIjoyMDg1NTQxMzU2fQ.LZCrx5IKqkbfO0j9tCeYz309q59lmVuqyfm0DS6JOxk")

stats = {"updated": 0, "failed": 0, "skipped": 0}

def api_patch(table, filters, data, description=""):
    """PATCH a record via Supabase REST API."""
    url = f"{SUPAB_URL}/rest/v1/{table}?{filters}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="PATCH")
    req.add_header("apikey", SUPAB_KEY)
    req.add_header("Authorization", f"Bearer {SUPAB_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    try:
        urllib.request.urlopen(req, timeout=10)
        stats["updated"] += 1
        return True
    except urllib.error.HTTPError as e:
        print(f"  FAILED ({e.code}): {description} — {e.read().decode()[:200]}")
        stats["failed"] += 1
        return False
    except Exception as e:
        print(f"  FAILED: {description} — {e}")
        stats["failed"] += 1
        return False

def api_post(table, data, description=""):
    """POST a new record via Supabase REST API."""
    url = f"{SUPAB_URL}/rest/v1/{table}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", SUPAB_KEY)
    req.add_header("Authorization", f"Bearer {SUPAB_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    try:
        urllib.request.urlopen(req, timeout=10)
        stats["updated"] += 1
        return True
    except urllib.error.HTTPError as e:
        print(f"  FAILED ({e.code}): {description} — {e.read().decode()[:200]}")
        stats["failed"] += 1
        return False

def api_get(table, filters, fields="id,name"):
    """GET records from Supabase REST API."""
    url = f"{SUPAB_URL}/rest/v1/{table}?select={fields}&{filters}"
    req = urllib.request.Request(url)
    req.add_header("apikey", SUPAB_KEY)
    req.add_header("Authorization", f"Bearer {SUPAB_KEY}")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  GET FAILED: {e}")
        return []

def update_restaurant(name_filter, data, desc=""):
    """Find restaurant by name and update it."""
    restaurants = api_get("restaurants", f"name=ilike.*{urllib.request.quote(name_filter)}*&is_active=eq.true")
    if not restaurants:
        print(f"  SKIP: {name_filter} not found")
        stats["skipped"] += 1
        return False
    rid = restaurants[0]["id"]
    return api_patch("restaurants", f"id=eq.{rid}", data, desc or name_filter)

def update_restaurant_by_id(rid, data, desc=""):
    return api_patch("restaurants", f"id=eq.{rid}", data, desc)

def update_deep_profile_by_id(rid, data, desc=""):
    return api_patch("restaurant_deep_profiles", f"restaurant_id=eq.{rid}", data, desc)

def update_occasion_by_id(rid, data, desc=""):
    return api_patch("occasion_scores", f"restaurant_id=eq.{rid}", data, desc)

# ============================================================
# SECTION 1: Cuisine type reclassifications (from existing migrations + new)
# ============================================================
print("\n=== SECTION 1: Cuisine Type Fixes ===")

cuisine_fixes_by_name = {
    # From existing migrations 000006-000008
    "Maple & Ash": "Steak",
    "Taxim": "Greek",
    "Le Piano": "French",
    "Inkwell": "American",
    "Sparrow": "American",
    "Bokeh": "American",
    "Clara": "American",
    "Love Street": "Italian",
    "Lula Cafe": "American",
    "The Nook Andersonville": "Brunch",
    "The Meadowlark": "American",
    "Lemon": "Brunch",
    "The Barrel": "Mexican",
    "Apero": "Mediterranean",
    "Nobody's Darling": "American",
    "Electric Funeral": "American",
    "Quality Time": "American",
    "The Charleston": "American",
    "The Press Room": "American",
    "Lone Wolf": "American",
    "Remedy": "Brunch",
    "The Getaway": "American",
    "The Double Urban Tavern": "American",
    "Tied House": "American",
    "The Native": "Brunch",
    "Fat Chris's Pizza": "Pizza",
    "Piece Pizzeria": "Pizza",
    "Big Star Wicker Park": "Tex-Mex",
}

# Lookup + fix each
for name, cuisine in cuisine_fixes_by_name.items():
    update_restaurant(name, {"cuisine_type": cuisine, "updated_at": "now()"}, f"{name} → {cuisine}")

# Fix by exact ID (from new Fusion reclassification)
cuisine_fixes_by_id = {
    "1176a80d-20f2-4d35-b6a7-56ba62a9b7dd": ("Alinea", "New American"),
    "2c99eb9c-2c50-4b13-b539-b58fb4b3b819": ("Amici-Chicago", "Italian"),
    "8f1fe3e3-2e7c-49db-b8e1-f6748f89a6da": ("Bayan Ko", "Filipino"),
    "df98dc14-ac7d-427a-923d-9b622e73d598": ("Bayan Ko Diner", "Filipino"),
    "334796ce-b2d8-4e0a-8151-1dc774471fc9": ("Bel Ami Lounge", "Cocktail Bar"),
    "758fa5b1-edd6-446b-86f5-55f8f654d258": ("Bigsuda", "Thai"),
    "e33ad5c8-5a14-4994-b7d1-ce136e124700": ("BiXi Beer", "American"),
    "1955febe-06f7-4795-acf9-85f7d7bfb0da": ("Boonie's Filipino", "Filipino"),
    "5ea16f2b-58d3-4efc-8119-d0ba8350aa56": ("bopNgrill", "Korean"),
    "50943c50-2315-4ebf-be0b-c86fef53cd29": ("Bowls of Rice Chinatown", "Chinese"),
    "ac3344f5-39e8-4723-ab0e-d2f8684f436b": ("Bowls of Rice Avondale", "Chinese"),
    "77f3fc24-221f-4657-9f17-3c09f8da7724": ("Brehon Pub", "Irish"),
    "f8a5ec70-7168-4330-ade9-4bb6c7243637": ("Bunch of Dumplings", "Chinese"),
    "39298903-ca41-409b-b292-6a2a87f91d97": ("Cafe Beograd", "Mediterranean"),
    "180f7695-2f76-4159-8a04-aa5f1fecd7d4": ("Café Crèmerie", "French"),
    "ced9bcb5-4b6b-4bd1-b74d-e1b70a929c4c": ("CASA MADAI", "Mexican"),
    "4035b876-14e2-44f7-9393-a67694b287ee": ("Cebu Chicago", "Filipino"),
    "bd887fb9-76bb-4c2d-b5d1-5fbaac1ca29c": ("Chant Restaurant", "American"),
    "e3657134-8c97-48f2-980e-047ca99d1bce": ("Chief O'Neill's", "Irish"),
    "0c3efdc5-5dd8-483c-bf69-747de87c1a18": ("CHUNKY BOSS", "American"),
    "76a98d7d-8e11-4607-bab9-5013425d1e59": ("Cuckoo", "Cocktail Bar"),
    "c98de5cb-c2b7-4f4a-977c-b3968a80d942": ("Del Sur Bakery", "Latin American"),
    "56b00697-6b77-4f10-b50f-73e3904d200b": ("Dove's Luncheonette", "Mexican"),
    "4c0e3ce3-41e4-4854-b117-99488000df49": ("Feld", "American"),
    "3845c5f0-018f-4b97-b503-70b1c15e81ac": ("Gene's Sausage Shop", "American"),
    "3e6bde1c-f7cb-4ce1-81e9-570ac8f218fd": ("Gideon Welles", "American"),
    "ec7dab51-7be1-472a-9153-6dff4de1a09d": ("Great China House", "Chinese"),
    "8430902e-ac96-4f78-8b90-e61818f79d01": ("Hello Jasmine", "Chinese"),
    "75df4df6-81da-42cf-99ae-c57c14bf66d1": ("Hello Jasmine LP", "Chinese"),
    "8f4993c7-821e-43a0-8864-2a79b278bb0b": ("Himmel's", "American"),
    "453e78f0-30e4-4557-9666-648d78c820ea": ("Hiro Bar Izakaya", "Japanese"),
    "9eaefe45-d087-488b-9e6c-fe99c9cd5c4c": ("Hiromi's Oriental", "Japanese"),
    "246abc94-7905-4187-801d-ab332cfa5837": ("Kaiser Tiger", "American"),
    "1d931ad0-07a8-47f7-8190-b61a7f3d56c3": ("Kanin", "Filipino"),
    "e578d046-ea59-4d21-ace6-d4697654a2de": ("Kraken Sushi", "Japanese"),
    "a31694c2-747a-4dd1-bdd8-6e3b131d795d": ("Kubo Chicago", "Filipino"),
    "898828a7-5806-4729-a4b7-5031db423b6e": ("Laschet's Inn", "American"),
    "29a4acf3-832b-45f8-93f1-e85a2891e8a6": ("Loon", "American"),
    "1be5781b-090d-4546-b1be-28c75befd278": ("Mano Modern Cafe", "Coffee/Cafe"),
    "a6693763-4bca-4f1c-a545-ce40990dec14": ("Mao Bar", "Cocktail Bar"),
    "482d0824-c49f-47e6-b56d-7bfc064d36c7": ("Marrakech", "Mediterranean"),
    "e1f387da-57e0-4f91-99ed-0237eff01707": ("Matilda Restaurant", "American"),
    "29146b02-6ab8-45b6-9935-a0cf302de1a8": ("Mirra", "Latin American"),
    "37a5a8af-38ee-4a1d-9f90-cae2a2dd714a": ("Mott St", "American"),
    "5b862ae8-6b7a-4558-9dea-7f4cf4d6c319": ("O'Donovan's", "Irish"),
    "1c6a395f-39db-48db-88b1-7d53f264da77": ("O'Shaughnessy's", "Irish"),
    "df7c7a75-321d-46ad-af88-33a598017ba3": ("OMI Cafe", "Japanese"),
    "22fbbcfa-5503-4cde-bb47-f723b8dce42e": ("Panlasa", "Filipino"),
    "e691bcc9-e29c-4b7a-b5af-eef7e3bcf854": ("Parachute HiFi", "Korean"),
    "a2e395c9-cc4a-44cd-99ab-6a90ef65c61a": ("pig & fire", "BBQ"),
    "1c6f4a46-d47c-451d-a4f2-5938dd83a2b5": ("Pingpong", "Chinese"),
    "248a4204-a454-42db-b3b8-6d8b8fac3ef0": ("Potsticker House", "Chinese"),
    "7eb1ec15-6be3-45b3-a533-d74b27e79466": ("Prost!", "American"),
    "6938dbad-9b2e-49f3-9ad3-50dbacf010b6": ("Resi's Bierstube", "American"),
    "221fbf9c-5490-4361-985e-03bef72b9be2": ("RYUU ASIAN BBQ", "Japanese"),
    "20a999cf-a941-4292-9b4b-f46a3c8215c7": ("Saint's Alp", "Chinese"),
    "63b59a0c-ce7b-4b37-851f-13bc31eefd33": ("Shokran", "Mediterranean"),
    "d9551820-e94c-4653-8bc7-982cb939cde3": ("SUBO Filipino", "Filipino"),
    "0036eef4-31fb-46df-810a-11141a72846a": ("Swadesi Cafe", "Indian"),
    "3aecebdf-1336-4527-a257-b02adf073843": ("Swedish Museum Cafe", "Coffee/Cafe"),
    "3ab00ccd-c337-429e-845f-a2abcb1051d1": ("Sweet Moon", "Coffee/Cafe"),
    "aa2848c0-9f96-484f-bd7d-e5cf624c9b88": ("Sweet Rice", "Thai"),
    "8dd22bab-b45a-4a74-8283-ca1985a5eb05": ("Taipei Cafe 1", "Chinese"),
    "d7863b79-4dba-4514-a91d-772103a946bd": ("Taipei Cafe 2", "Chinese"),
    "6f321743-c930-45a9-af47-3c1308d39e5e": ("Take a Bao", "Chinese"),
    "35b65ff0-6fc0-43bb-933a-3cd67eb76eb1": ("Taste of Canton", "Chinese"),
    "2b5e6b98-6d74-4037-bd0f-8af775c36005": ("Ten Cafe", "Coffee/Cafe"),
    "18bb6470-bf06-4a93-b694-df39b3810bb3": ("Ten Seconds Yunnan", "Chinese"),
    "64d39ce0-0fb4-4a26-8349-50e354bdfbc7": ("Bamboo Room", "Cocktail Bar"),
    "0c1de129-86d3-4b12-995b-4058f7e1be5a": ("The Berghoff", "American"),
    "c0790602-d545-4ffe-8641-800675d4f81f": ("The Embassy", "American"),
    "9a24d1e9-4488-477f-8747-a99844da6a2a": ("The Glunz Tavern", "American"),
    "bfc5cc4d-ed59-4954-b7c8-22459dc68983": ("Three Dots", "Cocktail Bar"),
    "5bfc1b08-e8c8-45d6-8f22-fe1e4d4ba8cb": ("Union Sushi", "Japanese"),
    "fc04f7f1-fd06-41f8-8a96-9efd99669684": ("Velvet Taco 1", "Mexican"),
    "99a18e01-1fb9-4dea-8de0-a5814b8666a7": ("Velvet Taco 2", "Mexican"),
    "dae1c471-ebb5-4ba2-aa39-77f52e844063": ("WOK DONG", "Chinese"),
    "7d53c9bd-d729-407d-b0d3-edf33f810751": ("Ysabel's Grill", "Filipino"),
}

# Also fix 3LP
cuisine_fixes_by_name_extra = {
    "3LP": "BBQ",
    "Han 202": "Chinese",
}

for name, cuisine in cuisine_fixes_by_name_extra.items():
    update_restaurant(name, {"cuisine_type": cuisine}, f"{name} → {cuisine}")

# Ghareeb Nawaz → Pakistani
for r in api_get("restaurants", "name=ilike.*Ghareeb%20Nawaz*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"cuisine_type": "Pakistani"}, f"Ghareeb Nawaz → Pakistani")

# Girl & The Goat → New American
for r in api_get("restaurants", "name=ilike.*Girl*Goat*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"cuisine_type": "New American"}, f"Girl & The Goat → New American")

for rid, (name, cuisine) in cuisine_fixes_by_id.items():
    update_restaurant_by_id(rid, {"cuisine_type": cuisine}, f"{name} → {cuisine}")

# ============================================================
# SECTION 2: Lighting normalization
# ============================================================
print("\n=== SECTION 2: Lighting Normalization ===")

# Blanket normalizations via REST API
# "modern" → bright
for r in api_get("restaurants", "lighting_ambiance=eq.modern&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "bright"}, f"{r['name']} modern→bright")

# "candlelit" → dim
for r in api_get("restaurants", "lighting_ambiance=eq.candlelit&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "dim"}, f"{r['name']} candlelit→dim")

# "intimate" → dim
for r in api_get("restaurants", "lighting_ambiance=eq.intimate&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "dim"}, f"{r['name']} intimate→dim")

# "elegant" → dim
for r in api_get("restaurants", "lighting_ambiance=eq.elegant&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "dim"}, f"{r['name']} elegant→dim")

# "moody" → dim
for r in api_get("restaurants", "lighting_ambiance=eq.moody&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "dim"}, f"{r['name']} moody→dim")

# "industrial" → moderate
for r in api_get("restaurants", "lighting_ambiance=eq.industrial&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "moderate"}, f"{r['name']} industrial→moderate")

# "vibrant" → bright
for r in api_get("restaurants", "lighting_ambiance=eq.vibrant&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "bright"}, f"{r['name']} vibrant→bright")

# "colorful" → warm
for r in api_get("restaurants", "lighting_ambiance=eq.colorful&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "warm"}, f"{r['name']} colorful→warm")

# "neutral" → moderate
for r in api_get("restaurants", "lighting_ambiance=eq.neutral&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "moderate"}, f"{r['name']} neutral→moderate")

# "dramatic" → dim
for r in api_get("restaurants", "lighting_ambiance=eq.dramatic&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"lighting_ambiance": "dim"}, f"{r['name']} dramatic→dim")

# Now handle all free-text values not in {bright, moderate, dim, warm}
remaining = api_get("restaurants", "lighting_ambiance=not.in.(bright,moderate,dim,warm)&is_active=eq.true&lighting_ambiance=not.is.null", "id,name,lighting_ambiance")
for r in remaining:
    la = (r.get("lighting_ambiance") or "").lower()
    if "dim" in la or "candle" in la or "intimate" in la or "moody" in la or "dark" in la or "soft" in la:
        target = "dim"
    elif "bright" in la or "modern" in la or "airy" in la or "natural" in la or "functional" in la or "energetic" in la:
        target = "bright"
    elif "warm" in la or "cozy" in la or "rustic" in la or "inviting" in la or "golden" in la or "amber" in la or "ambient" in la or "festive" in la or "traditional" in la or "classic" in la or "mediterranean" in la or "colorful" in la or "welcoming" in la or "contemporary" in la or "sophisticated" in la or "elegant" in la or "vintage" in la:
        target = "warm"
    else:
        target = "moderate"  # Safe default
    update_restaurant_by_id(r["id"], {"lighting_ambiance": target}, f"{r['name']} '{r['lighting_ambiance']}'→{target}")

# Specific overrides from existing migrations
specific_lighting = {
    "Alinea": "dim",
    "Boka": "dim",
    "Smoque BBQ": "warm",
    "Frontera Grill": "warm",
    "Lula Cafe": "warm",
    "The Publican": "moderate",
    "North Pond": "warm",
}
for name, target in specific_lighting.items():
    update_restaurant(name, {"lighting_ambiance": target}, f"{name} → {target}")

# ============================================================
# SECTION 3: BYOB Policy Fixes
# ============================================================
print("\n=== SECTION 3: BYOB Policy Fixes ===")

# From existing migrations
byob_fixes_by_name = {
    "Smoque BBQ": "full_byob",
    "Schwa": "full_byob",
    "Monteverde": "full_bar",
    "Superkhana": "full_bar",
    "Skylark": "full_bar",   # It's a bar in Pilsen
    "Chez Joel": "full_bar",
}
for name, byob in byob_fixes_by_name.items():
    restaurants = api_get("restaurant_deep_profiles", f"restaurants.name=ilike.*{urllib.request.quote(name)}*", "restaurant_id,byob_policy,restaurants(name)")
    # Use the simpler approach: find restaurant first
    rests = api_get("restaurants", f"name=ilike.*{urllib.request.quote(name)}*&is_active=eq.true")
    for r in rests:
        update_deep_profile_by_id(r["id"], {"byob_policy": byob}, f"{r['name']} byob→{byob}")

# Bar contradiction fixes
bar_names = ["Nobody's Darling", "Elixir Andersonville", "Phlavz", "Farm Bar", "Bar Roma",
             "BellyBowl Kitchen & Lounge", "Truffle Restaurant", "South Of The Border"]
for name in bar_names:
    rests = api_get("restaurants", f"name=ilike.*{urllib.request.quote(name)}*&is_active=eq.true")
    for r in rests:
        update_deep_profile_by_id(r["id"], {"byob_policy": "full_bar"}, f"{r['name']} byob→full_bar (bar)")

# ============================================================
# SECTION 4: Service Style NULL fixes
# ============================================================
print("\n=== SECTION 4: Service Style Fixes ===")

service_fixes = {
    "a77c263a-22b1-4a38-a76e-5cd7436c79e2": ("Benihana", "Full Table Service", "full_bar"),
    "e6419257-23bf-429e-97b2-4b0b5bbc0140": ("Koto Hibachi", "Full Table Service", "full_bar"),
    "0b70bbdf-7b99-4ce3-b960-fc079f497c1e": ("La Lena Restaurante", "Full Table Service", "full_bar"),
}
for rid, (name, style, byob) in service_fixes.items():
    update_deep_profile_by_id(rid, {"service_style": style, "byob_policy": byob}, f"{name} service+byob")

# Au Cheval service fix from existing migration
rests = api_get("restaurants", "name=ilike.*Au%20Cheval*&is_active=eq.true")
for r in rests:
    update_deep_profile_by_id(r["id"], {"service_style": "Full Table Service"}, f"Au Cheval service")

# Galit fix
rests = api_get("restaurants", "name=eq.Galit&is_active=eq.true")
for r in rests:
    update_deep_profile_by_id(r["id"], {"service_style": "Full Table Service"}, f"Galit service")

# ============================================================
# SECTION 5: Neighborhood ID fixes
# ============================================================
print("\n=== SECTION 5: Neighborhood ID Fixes ===")

# ZIP → neighborhood mapping for Chicago
zip_to_hood = {
    "60601": "5fbd75bf-acdd-4287-85e9-6cb0a2f3338e",  # Loop
    "60602": "5fbd75bf-acdd-4287-85e9-6cb0a2f3338e",  # Loop
    "60603": "5fbd75bf-acdd-4287-85e9-6cb0a2f3338e",  # Loop
    "60604": "5fbd75bf-acdd-4287-85e9-6cb0a2f3338e",  # Loop
    "60605": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # South Loop
    "60606": "5fbd75bf-acdd-4287-85e9-6cb0a2f3338e",  # Loop
    "60607": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # West Loop
    "60608": "fee79b01-ceff-4755-8291-3a08190da0cd",  # Pilsen
    "60609": "6837c616-6aff-42d1-9aa3-a25bf9e477fd",  # Bridgeport
    "60610": "d6251d9f-b92f-4e05-a8f5-ee31757eecf1",  # Gold Coast
    "60611": "5c40d303-b8bf-47b6-8b51-6a81ad4476e5",  # Streeterville
    "60612": "e247dd15-e32d-4580-8aa3-996c3f12c65d",  # Little Italy
    "60613": "103eeb7e-1a9f-46d4-b246-b07d60ceebcd",  # Lakeview
    "60614": "acbcd031-160f-406c-978b-18ac932d1471",  # Lincoln Park
    "60615": "6b0023d5-9f4b-41f5-b3f3-085eb34ef068",  # Hyde Park
    "60616": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Chinatown
    "60617": "7913d716-17f2-4634-893d-3a3f1029322b",  # Woodlawn (closest)
    "60618": "44ecdcc1-6172-4ff1-b888-e151a0b61ba4",  # North Center
    "60619": "7913d716-17f2-4634-893d-3a3f1029322b",  # Woodlawn
    "60620": "7913d716-17f2-4634-893d-3a3f1029322b",  # Woodlawn
    "60621": "5acdcc71-4275-4dcc-a4d5-1694b011c21c",  # Bronzeville
    "60622": "462906ef-c5c1-4376-b439-474756b38698",  # Wicker Park
    "60623": "5de7622a-0059-48bc-8a26-560f6b21b80e",  # Back of the Yards
    "60624": "f97d690e-f10e-4761-9ba4-3c11ef40f40e",  # Humboldt Park
    "60625": "535c1a4f-51c5-405a-8888-3fea290c5b53",  # Lincoln Square
    "60626": "e37be206-6f91-44e9-bdaa-3eefbef02dca",  # Rogers Park
    "60630": "549fee5a-d225-4195-b11d-f2ee5b00884c",  # Irving Park
    "60631": "549fee5a-d225-4195-b11d-f2ee5b00884c",  # Irving Park
    "60634": "549fee5a-d225-4195-b11d-f2ee5b00884c",  # Irving Park
    "60636": "7913d716-17f2-4634-893d-3a3f1029322b",  # Woodlawn
    "60637": "6b0023d5-9f4b-41f5-b3f3-085eb34ef068",  # Hyde Park
    "60639": "549fee5a-d225-4195-b11d-f2ee5b00884c",  # Irving Park (closest)
    "60640": "f3a2adba-549e-47b7-a9a1-a9a292788c99",  # Uptown
    "60641": "549fee5a-d225-4195-b11d-f2ee5b00884c",  # Irving Park
    "60642": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # West Loop
    "60643": "7913d716-17f2-4634-893d-3a3f1029322b",  # South side
    "60644": "f97d690e-f10e-4761-9ba4-3c11ef40f40e",  # Humboldt Park
    "60647": "690b18cd-4d07-4d93-a914-c23b6fa370bd",  # Logan Square
    "60649": "6b0023d5-9f4b-41f5-b3f3-085eb34ef068",  # Hyde Park
    "60651": "f97d690e-f10e-4761-9ba4-3c11ef40f40e",  # Humboldt Park
    "60652": "5de7622a-0059-48bc-8a26-560f6b21b80e",  # Back of the Yards (closest)
    "60653": "6b0023d5-9f4b-41f5-b3f3-085eb34ef068",  # Hyde Park / Bronzeville
    "60654": "e4f2562f-6e8d-4df6-9803-1a95e20a58ae",  # River North
    "60657": "103eeb7e-1a9f-46d4-b246-b07d60ceebcd",  # Lakeview
    "60659": "d0ea8dff-bbba-4fe1-b4c0-40fde0354a8d",  # Andersonville
    "60660": "d6ccf09e-97dc-45c7-ad5d-bdce6bae77f2",  # Edgewater
    "60661": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # West Loop
}

# Specific overrides where ZIP code doesn't capture the right neighborhood
address_overrides = {
    "4f532c98-e6b9-42c7-8f58-0e227213192f": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # Piccolo Sogno → West Loop (Halsted St)
    "d811982b-629b-4da8-a81d-ab4c7e9b1d26": "acbcd031-160f-406c-978b-18ac932d1471",  # Ox Bar → Lincoln Park (Clybourn)
    "736081d8-4119-44cf-bb86-6274bb76e9c2": "5d045c29-8e0e-4e9b-81d0-d2f450f88ca7",  # EL TRAGON → Old Town (Halsted)
    "20a2fcbb-88ff-42d9-9e23-f15a8ec0c486": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Chubby Cattle → Chinatown
    "57bf60a0-4492-4e63-9fb4-940f93b1372f": "103eeb7e-1a9f-46d4-b246-b07d60ceebcd",  # Cleo's → Lakeview
    "d2dcdd97-f85c-4649-8fef-d710d0a083dc": "103eeb7e-1a9f-46d4-b246-b07d60ceebcd",  # D'Agostino's Wrigleyville → Lakeview
    "ef2a9292-3743-4e63-b0b0-2ed4d0290b18": "76e8191a-bb52-4778-9f67-876b62a6e967",  # MCCB → Chinatown
    "040cdf88-ceff-4e46-bb90-21a89502f8cc": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Wei Dao Cheng Du → Chinatown
    "f6262d7d-1689-4e6e-9067-e568864936ab": "76e8191a-bb52-4778-9f67-876b62a6e967",  # MingHin Cuisine → Chinatown
    "b3c6d652-1618-4bc5-a4b4-8988e8755474": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Qing Xiang Yuan → Chinatown
    "03ace4f8-bb00-476e-8112-dc5e580b56dd": "6837c616-6aff-42d1-9aa3-a25bf9e477fd",  # Han 202 → Bridgeport
    "58190125-1041-4317-af78-bca1178ec8fb": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Haidilao → Chinatown
    "8aa762ba-ad5b-4431-8b59-248462805149": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Qiao Lin → Chinatown
    "d5b53cbc-eb97-4d11-9444-292be6966460": "76e8191a-bb52-4778-9f67-876b62a6e967",  # Joy Yee Chinatown → Chinatown
    "428c3ee2-f19f-43aa-b3d6-006a58499e33": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # Oliver's → South Loop
    "a24be809-9a4d-4fac-b7bd-f2629287df7b": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # Casa Tulum → South Loop
    "99cb7fb7-2b83-4de8-9b2e-361752914554": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # La Cantina Grill → South Loop
    "260f3a4d-c095-47c9-ac3d-09348aeac21a": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # Cafe Bionda → South Loop
    "911a2e3f-7f9d-47a2-ad32-b207effc8a19": "e84088fa-5b6e-4a69-b530-a567c3af00c8",  # Reggies → South Loop
    "4733ab19-87e7-4106-9b7b-3c834a555688": "6837c616-6aff-42d1-9aa3-a25bf9e477fd",  # Franco's → Bridgeport
    "1764c3c1-cd35-41fa-bebe-ead94e8e2150": "d6251d9f-b92f-4e05-a8f5-ee31757eecf1",  # LUXBAR → Gold Coast
    "354d9114-8d24-4a5c-8ca3-f329a99c9c09": "d6251d9f-b92f-4e05-a8f5-ee31757eecf1",  # Hugo's Frog Bar → Gold Coast
    "4ef87a6f-5ea7-4345-93c0-bcaedd97eb87": "d6251d9f-b92f-4e05-a8f5-ee31757eecf1",  # Carmine's → Gold Coast
    "e40aca51-42ec-48dc-9699-044ef991f5fb": "d6251d9f-b92f-4e05-a8f5-ee31757eecf1",  # Le Colonial → Gold Coast
    "0f459c76-6c1c-4ce0-a0e9-82d6e02f3f26": "5c40d303-b8bf-47b6-8b51-6a81ad4476e5",  # Niu Japanese → Streeterville
    "b0146a44-bfc5-4285-b9c7-6d1b70fdab0c": "5c40d303-b8bf-47b6-8b51-6a81ad4476e5",  # Pinched on the River → Streeterville
    "9e9e0c31-186f-4d7e-8f2f-59f19213fc38": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # Provare → West Loop (Chicago Ave)
    "6910492c-fe77-496e-9c63-c88015b99a1f": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # Mart Anthony's → West Loop
    "94b8d054-0b86-4b8a-a8ed-c5af43ca782d": "8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb",  # Diego → West Loop (Ogden Ave)
    "40852258-86a3-4e37-bb89-7677f960e0ca": "462906ef-c5c1-4376-b439-474756b38698",  # Frontier → Wicker Park (Milwaukee Ave)
    "6d8c2552-9daa-44c0-b927-482ef07ec5f7": "462906ef-c5c1-4376-b439-474756b38698",  # Mixteco Grill → Wicker Park
    "c27b344c-f530-4203-bdb1-3578af9b6ced": "5acdcc71-4275-4dcc-a4d5-1694b011c21c",  # Bronzeville Winery → Bronzeville
    "78875d54-5d67-405e-98f9-1cf960bb0ef3": "5acdcc71-4275-4dcc-a4d5-1694b011c21c",  # Norman's Bistro → Bronzeville
    "a5475098-e6d9-45c4-b50a-5314eb48d75c": "6b0023d5-9f4b-41f5-b3f3-085eb34ef068",  # Mezze → Hyde Park
    "fdcf51d0-ba44-453d-91ec-36bc6a61f166": "7913d716-17f2-4634-893d-3a3f1029322b",  # Calumet Fisheries → Woodlawn
    "4e62cb70-cf3e-4da5-88d0-53dc41be28b7": "fee79b01-ceff-4755-8291-3a08190da0cd",  # Mariscos La Grulla → Pilsen (Cermak)
    "6181fc8e-6c79-4c1f-8abb-4e1900b1a1cd": "535c1a4f-51c5-405a-8888-3fea290c5b53",  # Amano Bistro → Lincoln Square
    "ae80604d-83df-4770-9a23-4ce92209dcc8": "535c1a4f-51c5-405a-8888-3fea290c5b53",  # Garcia's → Lincoln Square
}

# Process all null-neighborhood restaurants
null_hood = api_get("restaurants", "neighborhood_id=is.null&is_active=eq.true", "id,name,address")
print(f"  Found {len(null_hood)} restaurants with NULL neighborhood_id")

for r in null_hood:
    rid = r["id"]
    addr = r.get("address", "")
    name = r.get("name", "")

    # Check specific overrides first
    if rid in address_overrides:
        hood_id = address_overrides[rid]
        update_restaurant_by_id(rid, {"neighborhood_id": hood_id}, f"{name} → neighborhood (override)")
        continue

    # Extract ZIP from address
    import re
    zip_match = re.search(r'(\d{5})', addr)
    if zip_match:
        zipcode = zip_match.group(1)
        if zipcode in zip_to_hood:
            hood_id = zip_to_hood[zipcode]
            update_restaurant_by_id(rid, {"neighborhood_id": hood_id}, f"{name} → neighborhood (ZIP {zipcode})")
        else:
            print(f"  SKIP: {name} — ZIP {zipcode} not mapped")
            stats["skipped"] += 1
    else:
        print(f"  SKIP: {name} — no ZIP in address '{addr[:60]}'")
        stats["skipped"] += 1

# ============================================================
# SECTION 6: Deactivate non-Chicago restaurants
# ============================================================
print("\n=== SECTION 6: Deactivations ===")

deactivations = {
    "b1afdc3d-6bbb-43a6-8552-8373ad7c15ae": "Habibi Mediterranean (Logan, UT — not Chicago)",
    "55b87821-bb9e-4eb3-a5f0-27bdb0702c77": "Wicker Park Seafood (ORD airport — not a restaurant)",
}
for rid, desc in deactivations.items():
    update_restaurant_by_id(rid, {"is_active": False}, f"DEACTIVATE: {desc}")

# Crab King Cajun in Oak Lawn, IL (not Chicago)
for r in api_get("restaurants", "name=ilike.*Crab%20King*&address=ilike.*Oak%20Lawn*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"is_active": False}, f"DEACTIVATE: {r['name']} (Oak Lawn, not Chicago)")

# TEST restaurant
for r in api_get("restaurants", "name=eq.TEST&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"is_active": False}, f"DEACTIVATE: TEST")

# Vinafood (Czechia)
for r in api_get("restaurants", "name=eq.Vinafood&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"is_active": False}, f"DEACTIVATE: Vinafood (non-Chicago)")

# ============================================================
# SECTION 7: Price level fixes (from existing migrations)
# ============================================================
print("\n=== SECTION 7: Price Level Fixes ===")

price_fixes = {
    "Smoque BBQ": "$",
    "Frontera Grill": "$$$",
    "RPM Italian": "$$$$",
    "Tied House": "$$",
}
for name, price in price_fixes.items():
    update_restaurant(name, {"price_level": price}, f"{name} → {price}")

# Au Cheval
for r in api_get("restaurants", "name=ilike.*Au%20Cheval*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"price_level": "$$"}, f"Au Cheval → $$")

# ============================================================
# SECTION 8: Dress code fixes (from existing migrations)
# ============================================================
print("\n=== SECTION 8: Dress Code Fixes ===")

dress_fixes = {
    "RPM Italian": "Smart Casual",
    "Schwa": "Casual",
    "Tied House": "Casual",
}
for name, dress in dress_fixes.items():
    update_restaurant(name, {"dress_code": dress}, f"{name} → {dress}")

# ============================================================
# SECTION 9: Outdoor seating fixes
# ============================================================
print("\n=== SECTION 9: Outdoor Seating Fixes ===")

outdoor_fixes = ["Aba", "Chez Joel"]
for name in outdoor_fixes:
    update_restaurant(name, {"outdoor_seating": True}, f"{name} → outdoor=true")

for r in api_get("restaurants", "name=ilike.*Girl*Goat*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"outdoor_seating": True}, "Girl & The Goat → outdoor=true")

for r in api_get("restaurants", "name=ilike.*Cindy*Rooftop*&is_active=eq.true"):
    update_restaurant_by_id(r["id"], {"outdoor_seating": True}, "Cindy's Rooftop → outdoor=true")

# ============================================================
# SECTION 10: Check average fixes
# ============================================================
print("\n=== SECTION 10: Check Average Fixes ===")

check_fixes = {
    "Kasama": 75,
    "Frontera Grill": 48,
    "RPM Italian": 70,
    "Momotaro": 80,
    "Cindy's Rooftop": 65,
    "Chez Joel": 45,
    "Galit": 95,
}
for name, avg in check_fixes.items():
    rests = api_get("restaurants", f"name=ilike.*{urllib.request.quote(name)}*&is_active=eq.true")
    for r in rests:
        update_deep_profile_by_id(r["id"], {"check_average_per_person": avg}, f"{name} check_avg→{avg}")

# Au Cheval check avg
for r in api_get("restaurants", "name=ilike.*Au%20Cheval*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"check_average_per_person": 30}, "Au Cheval check_avg→30")

# Uncle Mike's
for r in api_get("restaurants", "name=ilike.*Uncle%20Mike*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"check_average_per_person": 18, "kid_friendliness": 9, "service_style": "Counter", "byob_policy": "no_byob"}, "Uncle Mike's deep fixes")

# ============================================================
# SECTION 11: Reservation difficulty + wait time fixes
# ============================================================
print("\n=== SECTION 11: Reservation + Wait Time Fixes ===")

for r in api_get("restaurants", "name=ilike.*Au%20Cheval*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"reservation_difficulty": "hard_to_get", "typical_wait_minutes": 90}, "Au Cheval reservation")

for r in api_get("restaurants", "name=ilike.*Lula%20Cafe*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"reservation_difficulty": "recommended", "typical_wait_minutes": 20}, "Lula Cafe reservation")

for r in api_get("restaurants", "name=ilike.*Bavette*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"reservation_difficulty": "hard_to_get"}, "Bavette's reservation")

for r in api_get("restaurants", "name=ilike.*Wildberry*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"typical_wait_minutes": 60}, "Wildberry wait time")

# ============================================================
# SECTION 12: Occasion score fixes
# ============================================================
print("\n=== SECTION 12: Occasion Score Fixes ===")

# goosefoot hole_in_wall fix
for r in api_get("restaurants", "name=ilike.*goosefoot*&is_active=eq.true"):
    update_occasion_by_id(r["id"], {"hole_in_wall_factor": 3}, "goosefoot hole_in_wall→3")

# Au Cheval hole_in_wall
for r in api_get("restaurants", "name=ilike.*Au%20Cheval*&is_active=eq.true"):
    update_occasion_by_id(r["id"], {"hole_in_wall_factor": 5}, "Au Cheval hole_in_wall→5")

# Frontera date_friendly
for r in api_get("restaurants", "name=eq.Frontera Grill&is_active=eq.true"):
    update_occasion_by_id(r["id"], {"date_friendly_score": 7}, "Frontera date_friendly→7")

# RPM Italian family_friendly
for r in api_get("restaurants", "name=eq.RPM Italian&is_active=eq.true"):
    update_occasion_by_id(r["id"], {"family_friendly_score": 4}, "RPM Italian family→4")

# Lula Cafe hole_in_wall
for r in api_get("restaurants", "name=ilike.*Lula%20Cafe*&is_active=eq.true"):
    update_occasion_by_id(r["id"], {"hole_in_wall_factor": 5}, "Lula hole_in_wall→5")

# ============================================================
# SECTION 13: Awards/recognition fixes
# ============================================================
print("\n=== SECTION 13: Awards Fixes ===")

# Momotaro: Bib Gourmand → Michelin Star
for r in api_get("restaurants", "name=eq.Momotaro&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {
        "awards_recognition": ["Michelin Star"]
    }, "Momotaro → Michelin Star")

# RPM Steak: chef_notable
for r in api_get("restaurants", "name=eq.RPM Steak&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"chef_notable": True}, "RPM Steak chef_notable")

# Big Star: chef_notable + live_music
for r in api_get("restaurants", "name=ilike.*Big%20Star%20Wicker*&is_active=eq.true"):
    update_deep_profile_by_id(r["id"], {"chef_notable": True}, "Big Star chef_notable")
    update_restaurant_by_id(r["id"], {"live_music": True}, "Big Star live_music")

# ============================================================
# DONE
# ============================================================
print(f"\n{'='*60}")
print(f"COMPLETE: {stats['updated']} updated, {stats['failed']} failed, {stats['skipped']} skipped")
print(f"{'='*60}")
