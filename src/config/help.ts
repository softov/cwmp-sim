import { configFields } from "./fields.ts";

export function printHelp(): string {
  const lines: string[] = [];

  lines.push("Usage: cwmp-sim [options]");
  lines.push("");
  lines.push("Options:");

  for (const field of configFields) {
    const names = [field.flag, field.env ? `env:${field.env}` : undefined].filter(Boolean);

    const defaultValue = field.format != null ? field.format(field.default as never) : String(field.default);

    lines.push(`  ${names.join(", ")}`);
    lines.push(`      ${field.label}`);
    lines.push(`      Default: ${defaultValue}`);

    if (field.description) {
      lines.push(`      ${field.description}`);
    }

    lines.push("");
  }

  lines.push("  --help");
  lines.push("      Show this help message");

  return lines.join("\n");
}
