import { listApplications } from "@jat/core";

export async function listCommand(root: string): Promise<void> {
  const { rows, warnings } = listApplications(root);
  if (rows.length === 0) {
    console.log("no applications yet — nothing tracked");
    return;
  }
  console.log(
    `${"date".padEnd(10)} ${"company".padEnd(12)} ${"role".padEnd(24)} ${"track".padEnd(5)} ${"region".padEnd(6)} ${"status".padEnd(12)} ${"job".padEnd(12)} ${"pdf".padEnd(7)}`,
  );
  for (const r of rows) {
    console.log(
      `${r.date.padEnd(10)} ${r.company.slice(0, 12).padEnd(12)} ${r.role.slice(0, 24).padEnd(24)} ` +
        `${r.track.padEnd(5)} ${r.region.padEnd(6)} ${r.status.padEnd(12)} ${r.jobStatus.padEnd(12)} ${r.pdf.padEnd(7)}`,
    );
  }
  if (warnings.length > 0) {
    console.log("");
    for (const w of warnings) console.log(`! ${w}`);
  }
}
