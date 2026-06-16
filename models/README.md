# Device models

A **model** is a full parameter tree for a device *type* (a ZTE, a Huawei, a
generic IGD). A device loads one as its base tree instead of the built-in
`defaultTR98/181`. The simulator then injects any **missing required nodes**
(`ManagementServer`, the diagnostics subtrees) from its defaults and overlays
per-device identity (`{i}` serial / OUI / MAC + ACS / Connection-Request config),
so a model never has to carry boilerplate or real credentials.

Pass a model as a **file path** to `--model` (`.csv` or `.json`, by extension).
Each `--model` is an independent path, so models can live in any folder —
mix them freely across a fleet:

```
cwmp-sim \
  --model ./models/generic-tr098.csv --count 5 \
  --model /opt/vendor/huawei.json    --count 3
```

`--model default` (or omitting it) uses the built-in `defaultTR98/181` tree.
This folder just holds the bundled example models.

## CSV format (rich)

Header-keyed, RFC 4180. Canonical columns:

| Column | Meaning |
|---|---|
| `Parameter`  | full path, e.g. `InternetGatewayDevice.DeviceInfo.SerialNumber` |
| `Object`     | `true` → container node · `false` → leaf |
| `Writable`   | `true`/`false` |
| `Value`      | leaf value (blank for containers) |
| `Value type` | xsd type, e.g. `xsd:string`, `xsd:unsignedInt` |

Columns are read **by name**, so extra columns are ignored — a raw **GenieACS
device dump** (12 columns, with `*timestamp` / `Notification` / `Access list`)
loads unchanged. Virtual rows outside the device root (GenieACS's `DeviceID.*`,
`Tags.*`) are skipped. The root (`Device` vs `InternetGatewayDevice`) is inferred
from the rows.

See [`generic-tr098.csv`](./generic-tr098.csv).

## JSON format (plain)

A plain nested object of values — no `_value/_type/_writable`. Types are inferred
and leaves default to writable. Use CSV when you need exact writability / xsd
types per leaf.

See [`generic-tr181.json`](./generic-tr181.json).
