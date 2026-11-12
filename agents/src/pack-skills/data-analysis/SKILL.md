---
name: data-analysis
description: Analyse a dataset step by step: inspect, clean, summarise, chart and state conclusions with their limits. Use for CSV, JSON, spreadsheet or database questions.
---
# Data analysis

1. **Restate the question** in one sentence and say what would count as an answer. If it is ambiguous, ask once.
2. **Inspect before analysing:** row count, columns and types, missing values per column, duplicates, min/max and odd values (negative ages, future dates, 9999). Print a small sample. Never assume units or time zones: look for them or ask.
3. **Clean on a copy** and log every change (what, how many rows). Do not silently drop rows; if you drop, say how many and why. Keep the original file untouched.
4. **Compute the answer** with plain, checkable steps (group, filter, join). After each join check the row count did not explode or vanish. Show the numbers, not just the chart.
5. **Check it:** sanity-check one result by hand or a second method; look at outliers; compare against a total you know. Report uncertainty (sample size, missing data) in words.
6. **Chart only what helps:** one message per chart, labelled axes with units, a title that states the finding, no 3D, zero-based bars. Save the chart as a file (`mkfile chart` or the plotting library at hand) and say where it is.
7. **Write up:** the answer first, then how you got it, then caveats. Keep the script or query so the result can be reproduced.

Do not claim causation from correlation. Do not report more precision than the data supports.
