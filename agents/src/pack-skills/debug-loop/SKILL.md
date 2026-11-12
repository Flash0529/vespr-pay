---
name: debug-loop
description: Find and fix a bug methodically: reproduce it, narrow it, form a hypothesis, test it, fix the cause, and prove the fix. Use for errors, failing tests and "it does not work".
---
# Debug loop

1. **Reproduce first.** Get the exact steps and the exact error or wrong output. If you cannot make it happen, say so and ask for what is missing (input, version, logs). A fix without a reproduction is a guess.
2. **Read the evidence:** the full error message and stack trace, the line it points to, what changed recently (`git diff`, last commits). The bug is usually near the first frame in our own code, not in the library.
3. **Narrow it down:** cut the problem in half again and again (comment out, add a print or a log at a boundary, shrink the input, bisect the commits). Write down what you ruled out.
4. **One hypothesis at a time:** state it ("the list is empty here because X"), predict what you would see if it is true, and test exactly that. Change one thing per test.
5. **Fix the cause.** Do not hide the error (empty `catch`, a retry, a default value) unless that is the real intended behaviour. Check nearby code for the same mistake.
6. **Prove it:** run the reproduction again, run the tests, and add a test that fails without the fix. Remove debugging prints.
7. **Explain in three lines:** what was wrong, why it happened, what you changed.

If after two honest attempts you are still guessing, stop, summarise what you know and do not know, and ask the person or propose a smaller experiment.
