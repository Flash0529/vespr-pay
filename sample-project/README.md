# VESPR demo project

A tiny shopping cart with a failing test. Things to try with two people in the workspace:

1. Open `cart.py` in two windows and type: everyone's cursor shows up live.
2. In the VESPR chat: `@coder run python3 -m unittest -q` (see the failures), then `@coder fix the discount bug in cart.py and run the tests again`.
3. Switch the agent mode (Manual, Accept edits, Auto, Plan) and watch what it asks before acting.
4. Hover a line to see who wrote it, or press "Who wrote what". Press "Replay" to rewind the session.
5. Step away for a few minutes, come back, press "Catch me up".
