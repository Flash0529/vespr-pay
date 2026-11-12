# VESPR in C# (native app, in progress)

The JavaScript app is the product; this is its C# port, held to the JavaScript's exact answers. Read `PLAYBOOK.md` first.

- `Vespr.Core/`: the logic, ported module by module (`Fuzzy` done; `Js` holds the JavaScript-exact string helpers every port uses)
- `Vespr.Core.Tests/`: xUnit; `Golden.cs` checks each port against `golden/<module>.json`
- `golden/cases/<module>.mjs` + `tools/golden.mjs`: record the JavaScript's answers (`node native/tools/golden.mjs <module>`)

Build and test (.NET 8): `cd native && dotnet test`. On the Pi the SDK is in `/home/user/.dotnet` (`export PATH=/home/user/.dotnet:$PATH DOTNET_ROOT=/home/user/.dotnet`).
