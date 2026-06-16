import { configFields } from "./fields.ts";

export function printHelp(): string {
  const lines: string[] = [];

  lines.push("Usage: cwmp-sim [options]");
  lines.push("");
  lines.push("Fleet composition (grouped flags):");
  lines.push("  Each --model <name|path> opens a device group; the [group] flags that");
  lines.push("  follow bind to it until the next --model. Global flags apply fleet-wide.");
  lines.push("  Omitting --model runs a single group (use --count for N).");
  lines.push("    cwmp-sim --model huawei --count 5 --model zte --count 10 --interval 5000");
  lines.push("");
  lines.push("Options:");

  for (const field of configFields) {
    const names = [field.flag, field.env ? `env:${field.env}` : undefined].filter(Boolean);

    const defaultValue = field.format != null ? field.format(field.default as never) : String(field.default);
    const scopeTag = field.scope === "group" ? " [group]" : "";

    lines.push(`  ${names.join(", ")}${scopeTag}`);
    lines.push(`      ${field.label}`);
    lines.push(`      Default: ${defaultValue}`);

    if (field.description) {
      lines.push(`      ${field.description}`);
    }

    lines.push("");
  }

  lines.push("  --off <feature> [group]");
  lines.push("      Disable a feature for the group (repeatable, case-insensitive):");
  lines.push("        inform — no periodic informs (boot/CR informs still fire)");
  lines.push("        cr     — don't register/advertise the Connection-Request route");
  lines.push("      e.g. --model zte --off inform --off cr");
  lines.push("");
  lines.push("  --help");
  lines.push("      Show this help message");

  return lines.join("\n");
}
