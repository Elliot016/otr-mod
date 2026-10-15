import type { Snapshot } from './previews-kit'

export const snapshot: Snapshot = {
  "enabled": {
    "true": {
      "frame": {
        "border": "alert",
        "bg": "surface1"
      },
      "nerd": [
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "\uea6c Delete cache.db",
              "color": "alert",
              "bold": true
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "Removes the file. No undo.",
              "color": "onSurface"
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "~/app/build/cache.db",
              "color": "alert"
            },
            {
              "text": "   ",
              "color": "onSurface"
            },
            {
              "text": "3.1 MB",
              "color": "warn"
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "surface1"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "1",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Cancel ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "surface1"
            },
            {
              "text": "  "
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "surface1"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "2",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Details ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "surface1"
            },
            {
              "text": "  "
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "surface1"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "3",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Delete cache.db ",
              "color": "alert",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "surface1"
            }
          ]
        }
      ],
      "safe": [
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "! Delete cache.db",
              "color": "alert",
              "bold": true
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "Removes the file. No undo.",
              "color": "onSurface"
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": "~/app/build/cache.db",
              "color": "alert"
            },
            {
              "text": "   ",
              "color": "onSurface"
            },
            {
              "text": "3.1 MB",
              "color": "warn"
            }
          ]
        },
        {
          "spans": [
            {
              "text": "▎",
              "color": "alert",
              "bg": "surface1"
            },
            {
              "text": " 1 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Cancel ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "  "
            },
            {
              "text": " 2 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Details ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "  "
            },
            {
              "text": " 3 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Delete cache.db ",
              "color": "alert",
              "bg": "surface3"
            }
          ]
        }
      ]
    },
    "false": {
      "nerd": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "rm build/cache.db"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "runs at once, nothing is held",
              "color": "muted"
            }
          ]
        }
      ],
      "safe": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "rm build/cache.db"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "runs at once, nothing is held",
              "color": "muted"
            }
          ]
        }
      ]
    }
  }
}
