from petid.records import ImageRecord, write_manifest, read_manifest


def test_manifest_roundtrip(tmp_path):
    recs = [
        ImageRecord(path="a.jpg", species="dog", individual_id="dogsworld:1", dataset="dogsworld", split="train"),
        ImageRecord(path="b.jpg", species="cat", individual_id="catind:7", dataset="catind", split="test"),
    ]
    out = tmp_path / "m.json"
    write_manifest(recs, str(out))
    back = read_manifest(str(out))
    assert back == recs


def test_record_is_frozen():
    r = ImageRecord(path="a.jpg", species="dog", individual_id="d:1", dataset="d")
    try:
        r.path = "b.jpg"
        assert False, "should be frozen"
    except Exception:
        pass
