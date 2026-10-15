// mod-progress / hooks/marks.ts, by v-amorim
// This mod's glyphs and limits, kept out of the shared style.ts; {U+XXXX} is a Nerd code point, one cell like every glyph.
export default {
  "glyphs": {
    "safe": {
      "running": "↻",
      "gaugeIcon": "▦",
      "gaugeFull": "■",
      "gaugeEmpty": "□",
      "barCell": "█",
      "agentDot": "●"
    },
    "nerd": {
      "running": "{U+F110}",
      "gaugeIcon": "{U+F035B}",
      "gaugeFull": "{U+F0C8}",
      "gaugeEmpty": "{U+F096}",
      "barCell": "█",
      "agentDot": "●"
    }
  },
  "gaugeCells": 5,
  "barCells": 8,
  "gaugeFrom": [0, 10, 39, 59, 79, 90],
  "windows": {
    "default": 200000,
    "oneMillion": 1000000
  }
}
