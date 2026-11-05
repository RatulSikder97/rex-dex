import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createProject, listProjects } from "@/lib/repo";
import { STAGES } from "@/lib/types";

export const GET = handle(async () => ok(listProjects()));

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
  stage: z.enum(STAGES).optional(),
  repo_path: z.string().max(1000).optional(),
  website_url: z.string().max(1000).optional(),
});

export const POST = handle(async (req: Request) => ok(createProject(await body(req, CreateSchema)), { status: 201 }));
