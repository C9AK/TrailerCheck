"""R8 structured PTI checklist.

The checklist is a flat dict of item-key -> bool. `pti_verified` is derived:
every required item checked, every required Left/Right pair fully checked,
and the optional corner rear ID lights pair either both checked or both
unchecked ("optional, but both must be checked if working").
"""

REQUIRED_SINGLES = [
    "side_dot_tape",
    "rear_dot_tape",
    "no_placards_attached",
    "tires_and_rims",
    "brakes_and_suspension",
    "airlines",
    "abs_light",
    "plate_light",
    "three_middle_rear_id_lights",
    "locks_horizontal",
    "zip_ties_on_locks",
]

REQUIRED_PAIRS = [
    "movable_mudflap",
    "front_clearance_light",
    "side_marker_light",
    "side_clearance_light",
    "turn_signal_light",
    "brake_light",
]

OPTIONAL_PAIRS = ["two_corner_rear_id_lights"]


def compute_pti_verified(checklist: dict | None) -> bool:
    if not checklist:
        return False

    def checked(key: str) -> bool:
        return bool(checklist.get(key))

    if not all(checked(k) for k in REQUIRED_SINGLES):
        return False
    for pair in REQUIRED_PAIRS:
        if not (checked(f"{pair}_left") and checked(f"{pair}_right")):
            return False
    for pair in OPTIONAL_PAIRS:
        left, right = checked(f"{pair}_left"), checked(f"{pair}_right")
        if left != right:  # one side only = inconsistent -> not verified
            return False
    return True
