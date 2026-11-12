---
name: vibe-build-loop
description: Build software by conversation: turn an idea into small working steps, run each one, look at the result, and fix before moving on. Use whenever the person describes what they want rather than how to build it.
---
# Vibe-coding build loop

The person describes what they want. Your job is to keep that fast **and** keep it working.

1. **Say it back in one sentence** and name what "done" looks like (what they will see or click). If two readings are possible, ask one short question; otherwise pick the simpler one and say so.
2. **Plan three to six small steps**, each ending in something visible or testable. The first step is the smallest thing that runs end to end (a page that loads, a command that prints), not the foundation.
3. **Do one step at a time:** change as little as needed, run it, and look at the actual result (output, screenshot, failing test). Never say "this should work": show that it does, or show the error.
4. **When it breaks, read the error before changing anything.** Fix the cause, not the symptom; if the same thing fails twice, stop and explain what you think is wrong before trying again.
5. **Keep the person oriented:** after each step say what changed, what to look at, and what comes next, in plain words. Offer two choices at most.
6. **Keep a safety net:** commit or save a working state after each step that works, so any step can be undone. Do not make large rewrites in one go.
7. **Do not invent:** if a library, API or file might not exist, check it. Prefer the standard library and tools already in the project. Do not add dependencies for something a few lines can do.
8. **Finish properly:** run everything once more, list what works and what does not, and say what you would do next. Leave the project runnable with one command written in the README.

Protect the basics even when moving fast: no secrets in code or chat, user input is never trusted, and anything that deletes or sends something outside waits for a yes.
