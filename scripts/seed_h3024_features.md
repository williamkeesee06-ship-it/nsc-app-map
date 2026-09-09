# H3024 Firestore seed (one doc per feature)

## Paths

```
/projects/H3024
  metadata: ProjectMetadata
  /features/{featureId}     ← one GeoJSON feature per doc (never whole FC)
  /permits/{permitId}
  /locateTickets/{ticketId}
  /progress/{featureId}
```

## Generate local GeoJSON first

```bash
python scripts/build_h3024_platform_geojson.py
# → apps/web/public/experiments/lake-stevens/h3024/platform.geojson
# → plant.json (compat twin)
```

## Hub anchor (only hard coord in print)

```
Lat: 47.939488
Lng: -122.157410
6105 Foster Slough Rd, Lake Stevens, WA 98290
```

## WA 811

Use **Utility Notification Center (UNC)** — https://www.utn.com — not 811Assist.

## Seed approach

1. Load `platform.geojson`
2. Call `featureCollectionToDocs(fc)` from `apps/api/src/services/h3024PlatformSchema.ts`
3. Batch write max 400 docs per batch to Firestore
4. Seed permits from `H3024_PERMIT_SEED`

Do **not** store the entire FeatureCollection as a single document.
