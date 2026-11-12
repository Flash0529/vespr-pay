---
name: fullstack-vite-supabase
description: Build modern web applications with Vite, React, TypeScript, and Supabase. Covers rapid scaffolding, schema migrations, Row-Level Security (RLS), type generation, and reactive state management. Use whenever building fullstack web apps or integrating databases with React.
---
# Fullstack Vite + React + TypeScript + Supabase

Follow this method when building fullstack web applications with Vite, React, TypeScript, and Supabase.

1. **Scaffolding & Clean Architecture**
   - Use the standard Vite template for React and TypeScript. A command has no terminal, so pass `--no-interactive`, and do not scaffold into `.`: it silently does nothing (it prints "Operation cancelled" and exits 0) when the folder already holds any file, even `.vespr/skills`. Scaffold into a temporary sub-folder, copy it up and remove it:
     `npm create vite@latest tmp-app -- --template react-ts --no-interactive && cp -r tmp-app/. . && rm -rf tmp-app`
     `npm install @supabase/supabase-js`
     The copy that a command made inside `tmp-app/` is also shared back, so delete that folder from the workspace with `delete_file` (a command's `rm` is not shared back).
   - The template's `src/App.tsx` imports a picture, `src/assets/hero.png`. Binary files a command makes are not shared back, so a build of the shared copy fails with a missing import: remove that import and the image that uses it from `src/App.tsx` right after scaffolding.
   - Organize code into clean layers:
     - `src/lib/supabase.ts` (singleton client instance)
     - `src/types/database.ts` (TypeScript types for tables and views)
     - `src/components/` (pure UI components)
     - `src/hooks/` (data hooks with loading/error handling)
     - `supabase/migrations/` (version-controlled SQL migrations)

2. **Environment & Security Safeguards**
   - Provide `.env.example` showing required keys:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
   - **Zero Secret Exposure:** Never put the `service_role` key in frontend code; the anon key is public and relies strictly on Row-Level Security (RLS).
   - In `src/lib/supabase.ts`, validate that URL and anon key exist before instantiating the client, giving a clear fallback message if not configured.

3. **Database Schema & Row-Level Security (RLS)**
   - Write SQL files under `supabase/migrations/` with clear table definitions.
   - **Always enable Row-Level Security:**
     ```sql
     ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
     CREATE POLICY "Users access their own data" ON public.items
       FOR ALL USING (auth.uid() = user_id);
     ```
   - Always include `id uuid default gen_random_uuid() primary key`, `user_id uuid references auth.users not null`, and `created_at timestamptz default now()`.

4. **Component Implementation**
   - Type all props and state cleanly without `any`.
   - Explicitly render three states: **loading spinner**, **error alert**, and **empty list fallback**.
   - Use async/await with try/catch when calling Supabase queries.

5. **Limits of the shared sandbox (say them out loud)**
   - There is no Supabase CLI and no Supabase credentials in the sandbox, and none may be added: write placeholders in `.env.example` and let the person put the real URL and anon key in their own environment. Never ask for a key in chat.
   - `npm install` and a Vite build may take longer than the 60 seconds a `run_command` gets. Start the project with `start_project` (it installs and starts in the background and waits up to 100 seconds), or run the install and the build as two commands.
   - The sandbox runs Node 20. A recent `@supabase/supabase-js` declares that it wants Node 22, so npm may print an engine warning: report it instead of hiding it.

6. **Running in the SDE Workspace**
   - Dev server must listen on `0.0.0.0` so the preview proxy can reach it:
     `npm run dev -- --host 0.0.0.0 --port $PORT --strictPort`
   - Test that the build compiles cleanly with `npm run build` before considering a task complete.
