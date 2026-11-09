# herdr-magpie-routing

A Herdr layout with a live view of [magpie](https://github.com/yetone/magpie)'s routing, opened from a Routing button next to Files and Changes, with Codex, Claude and Antigravity quota rings that open a Usage panel.

![Routing panel](preview.png)

## Install

Needs Herdr (built against 0.1.13) and magpie running on the same machine, with its gateway at `127.0.0.1:3425`.

```sh
curl -fsSL https://raw.githubusercontent.com/isnine/herdr-magpie-routing/main/install.sh | bash
```

From a clone, run `./install.sh` instead.

The script copies the mods and layout into `~/.config/herdr-app/`, overwriting earlier copies of them, then switches to the layout.

`ctrl-shift-l` switches back to your previous layout. See [RECIPE.md](RECIPE.md) for how it is built.

## License

The magpie bird, flight paths and animation timings come from magpie, under the MIT license in [LICENSE.magpie](LICENSE.magpie).
