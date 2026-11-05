import { handle, ok } from "@/lib/http";
import { allCommands, allDepartments, allPipelines, allThemes } from "@/lib/plugins/registry";

export const dynamic = "force-dynamic";

/** Everything enabled plugins add to the workbench (departments, palette commands, media pipeline presets). */
export const GET = handle(async () => ok({ departments: allDepartments(), commands: allCommands(), pipelines: allPipelines(), themes: allThemes() }));
