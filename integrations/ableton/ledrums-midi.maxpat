{
  "patcher": {
    "fileversion": 1,
    "classnamespace": "box",
    "rect": [
      0,
      0,
      1400,
      1120
    ],
    "default_fontsize": 12,
    "default_fontname": "Arial",
    "openinpresentation": 1,
    "devicewidth": 1040,
    "is_mpe": 1,
    "boxes": [
      {
        "box": {
          "id": "title",
          "maxclass": "comment",
          "text": "LEDrums MIDI",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            5,
            145,
            23
          ],
          "presentation": 1,
          "presentation_rect": [
            12,
            5,
            145,
            23
          ],
          "fontsize": 14
        }
      },
      {
        "box": {
          "id": "source-only",
          "maxclass": "comment",
          "text": "Patch source — not packaged or verified in Live",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            160,
            8,
            325,
            20
          ],
          "presentation": 1,
          "presentation_rect": [
            160,
            8,
            325,
            20
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "status",
          "maxclass": "comment",
          "text": "Waiting for Max device and Node",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            8,
            535,
            22
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            8,
            535,
            22
          ],
          "fontsize": 12
        }
      },
      {
        "box": {
          "id": "name-label",
          "maxclass": "comment",
          "text": "Source name",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            32,
            90,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            12,
            32,
            90,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "port-label",
          "maxclass": "comment",
          "text": "UDP port · loopback only",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            275,
            32,
            165,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            275,
            32,
            165,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "identity-label",
          "maxclass": "comment",
          "text": "Source ID",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            71,
            75,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            12,
            71,
            75,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "identity-value",
          "maxclass": "comment",
          "text": "Created after stored parameters restore",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            85,
            71,
            340,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            85,
            71,
            340,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "saved-hint",
          "maxclass": "comment",
          "text": "Save the Set after New identity. Existing mappings keep the old ID.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            69,
            540,
            20
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            69,
            540,
            20
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "node",
          "maxclass": "newobj",
          "text": "node.script max-bridge.cjs @autostart 1 @watch 0 @defer 1",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            20,
            1000,
            420,
            22
          ]
        }
      },
      {
        "box": {
          "id": "from-node",
          "maxclass": "newobj",
          "text": "route ready identity status",
          "numinlets": 2,
          "numoutlets": 4,
          "patching_rect": [
            20,
            1040,
            225,
            22
          ]
        }
      },
      {
        "box": {
          "id": "status-set",
          "maxclass": "newobj",
          "text": "prepend set",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            450,
            1040,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "node-log",
          "maxclass": "newobj",
          "text": "print LEDrums-Node",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            600,
            1040,
            140,
            22
          ]
        }
      },
      {
        "box": {
          "id": "source-id",
          "maxclass": "newobj",
          "text": "pattr source_id @parameter_enable 1",
          "numinlets": 1,
          "numoutlets": 3,
          "patching_rect": [
            20,
            270,
            275,
            22
          ],
          "varname": "source_id",
          "restore": [
            ""
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Source ID",
              "parameter_shortname": "LEDrums Source ID",
              "parameter_type": 3,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                ""
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "id-fan",
          "maxclass": "newobj",
          "text": "t l l",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            20,
            310,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "identity-send",
          "maxclass": "newobj",
          "text": "prepend identity",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            20,
            350,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "identity-set",
          "maxclass": "newobj",
          "text": "prepend set",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            170,
            350,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "source-name",
          "maxclass": "newobj",
          "text": "pattr source_name @parameter_enable 1",
          "numinlets": 1,
          "numoutlets": 3,
          "patching_rect": [
            320,
            270,
            275,
            22
          ],
          "varname": "source_name",
          "restore": [
            "LEDrums MIDI"
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Source Name",
              "parameter_shortname": "LEDrums Source Name",
              "parameter_type": 3,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                "LEDrums MIDI"
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "name-editor",
          "maxclass": "textedit",
          "text": "LEDrums MIDI",
          "numinlets": 1,
          "numoutlets": 4,
          "patching_rect": [
            12,
            49,
            250,
            22
          ],
          "varname": "source_name_editor",
          "keymode": 1,
          "outputmode": 1,
          "lines": 1,
          "wordwrap": 0,
          "presentation": 1,
          "presentation_rect": [
            12,
            49,
            250,
            22
          ]
        }
      },
      {
        "box": {
          "id": "name-route",
          "maxclass": "newobj",
          "text": "route text",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            320,
            230,
            85,
            22
          ]
        }
      },
      {
        "box": {
          "id": "name-fan",
          "maxclass": "newobj",
          "text": "t l l",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            320,
            310,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "name-set",
          "maxclass": "newobj",
          "text": "prepend set",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            460,
            350,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "name-send",
          "maxclass": "newobj",
          "text": "prepend name",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            320,
            350,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "port",
          "maxclass": "live.numbox",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            275,
            49,
            80,
            22
          ],
          "varname": "port",
          "presentation": 1,
          "presentation_rect": [
            275,
            49,
            80,
            22
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums UDP Port",
              "parameter_shortname": "UDP Port",
              "parameter_type": 1,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                4322
              ],
              "parameter_mmin": 1024,
              "parameter_mmax": 65535
            }
          }
        }
      },
      {
        "box": {
          "id": "port-send",
          "maxclass": "newobj",
          "text": "prepend port",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            275,
            479,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "new-identity-button",
          "maxclass": "live.text",
          "text": "New identity",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            365,
            32,
            115,
            40
          ],
          "texton": "New identity",
          "mode": 0,
          "parameter_enable": 0,
          "presentation": 1,
          "presentation_rect": [
            365,
            32,
            115,
            40
          ]
        }
      },
      {
        "box": {
          "id": "identity-bang",
          "maxclass": "newobj",
          "text": "route bang",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            660,
            200,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "identity-press",
          "maxclass": "newobj",
          "text": "sel 1",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            660,
            230,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "new-identity",
          "maxclass": "message",
          "text": "new-identity",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            660,
            270,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "live-ready",
          "maxclass": "newobj",
          "text": "live.thisdevice",
          "numinlets": 1,
          "numoutlets": 3,
          "patching_rect": [
            20,
            120,
            110,
            22
          ]
        }
      },
      {
        "box": {
          "id": "live-ready-order",
          "maxclass": "newobj",
          "text": "t b 1",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            20,
            160,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "node-ready-order",
          "maxclass": "newobj",
          "text": "t b 1",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            170,
            160,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "live-ready-flag",
          "maxclass": "newobj",
          "text": "int 0",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            20,
            200,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "node-ready-flag",
          "maxclass": "newobj",
          "text": "int 0",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            170,
            200,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "both-ready-live",
          "maxclass": "newobj",
          "text": "sel 1",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            20,
            235,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "both-ready-node",
          "maxclass": "newobj",
          "text": "sel 1",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            170,
            235,
            60,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-1",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            12,
            95,
            50,
            64
          ],
          "varname": "macro-1",
          "presentation": 1,
          "presentation_rect": [
            12,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 1",
              "parameter_shortname": "Macro 1",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-1-send",
          "maxclass": "newobj",
          "text": "prepend macro 1",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            12,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-2",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            70,
            95,
            50,
            64
          ],
          "varname": "macro-2",
          "presentation": 1,
          "presentation_rect": [
            70,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 2",
              "parameter_shortname": "Macro 2",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-2-send",
          "maxclass": "newobj",
          "text": "prepend macro 2",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            70,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-3",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            128,
            95,
            50,
            64
          ],
          "varname": "macro-3",
          "presentation": 1,
          "presentation_rect": [
            128,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 3",
              "parameter_shortname": "Macro 3",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-3-send",
          "maxclass": "newobj",
          "text": "prepend macro 3",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            128,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-4",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            186,
            95,
            50,
            64
          ],
          "varname": "macro-4",
          "presentation": 1,
          "presentation_rect": [
            186,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 4",
              "parameter_shortname": "Macro 4",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-4-send",
          "maxclass": "newobj",
          "text": "prepend macro 4",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            186,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-5",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            244,
            95,
            50,
            64
          ],
          "varname": "macro-5",
          "presentation": 1,
          "presentation_rect": [
            244,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 5",
              "parameter_shortname": "Macro 5",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-5-send",
          "maxclass": "newobj",
          "text": "prepend macro 5",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            244,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-6",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            302,
            95,
            50,
            64
          ],
          "varname": "macro-6",
          "presentation": 1,
          "presentation_rect": [
            302,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 6",
              "parameter_shortname": "Macro 6",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-6-send",
          "maxclass": "newobj",
          "text": "prepend macro 6",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            302,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-7",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            360,
            95,
            50,
            64
          ],
          "varname": "macro-7",
          "presentation": 1,
          "presentation_rect": [
            360,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 7",
              "parameter_shortname": "Macro 7",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-7-send",
          "maxclass": "newobj",
          "text": "prepend macro 7",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            360,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "macro-8",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            418,
            95,
            50,
            64
          ],
          "varname": "macro-8",
          "presentation": 1,
          "presentation_rect": [
            418,
            95,
            50,
            64
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Macro 8",
              "parameter_shortname": "Macro 8",
              "parameter_type": 0,
              "parameter_invisible": 0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "macro-8-send",
          "maxclass": "newobj",
          "text": "prepend macro 8",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            418,
            400,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "path-hint",
          "maxclass": "comment",
          "text": "MIDI passes directly. The Node tap never gates the instrument.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            100,
            530,
            20
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            100,
            530,
            20
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "routing-hint",
          "maxclass": "comment",
          "text": "Global MIDI routing + track-scoped note, gate, CC and macro addresses.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            123,
            535,
            20
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            123,
            535,
            20
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "midi-in",
          "maxclass": "newobj",
          "text": "midiin",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            20,
            660,
            65,
            22
          ]
        }
      },
      {
        "box": {
          "id": "midi-out",
          "maxclass": "newobj",
          "text": "midiout",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            20,
            740,
            65,
            22
          ]
        }
      },
      {
        "box": {
          "id": "midi-defer",
          "maxclass": "newobj",
          "text": "deferlow",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150,
            700,
            80,
            22
          ]
        }
      },
      {
        "box": {
          "id": "midi-send",
          "maxclass": "newobj",
          "text": "prepend midi",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150,
            740,
            120,
            22
          ]
        }
      },
      {
        "box": {
          "id": "replay",
          "maxclass": "newobj",
          "text": "t b b b b b b b b b b b b",
          "numinlets": 1,
          "numoutlets": 12,
          "patching_rect": [
            20,
            580,
            470,
            22
          ]
        }
      },
      {
        "box": {
          "id": "start",
          "maxclass": "message",
          "text": "start midi",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            530,
            580,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "close",
          "maxclass": "newobj",
          "text": "closebang",
          "numinlets": 0,
          "numoutlets": 1,
          "patching_rect": [
            850,
            1000,
            85,
            22
          ]
        }
      },
      {
        "box": {
          "id": "dispose",
          "maxclass": "message",
          "text": "dispose",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            850,
            1040,
            85,
            22
          ]
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "node",
            0
          ],
          "destination": [
            "from-node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "from-node",
            2
          ],
          "destination": [
            "status-set",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "status-set",
            0
          ],
          "destination": [
            "status",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "node",
            1
          ],
          "destination": [
            "node-log",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "from-node",
            1
          ],
          "destination": [
            "source-id",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "source-id",
            0
          ],
          "destination": [
            "id-fan",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "id-fan",
            1
          ],
          "destination": [
            "identity-set",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "identity-set",
            0
          ],
          "destination": [
            "identity-value",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "id-fan",
            0
          ],
          "destination": [
            "identity-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "identity-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-editor",
            0
          ],
          "destination": [
            "name-route",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-route",
            0
          ],
          "destination": [
            "source-name",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "source-name",
            0
          ],
          "destination": [
            "name-fan",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-fan",
            1
          ],
          "destination": [
            "name-set",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-set",
            0
          ],
          "destination": [
            "name-editor",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-fan",
            0
          ],
          "destination": [
            "name-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "name-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "port",
            0
          ],
          "destination": [
            "port-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "port-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "new-identity-button",
            0
          ],
          "destination": [
            "identity-bang",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "identity-bang",
            0
          ],
          "destination": [
            "new-identity",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "identity-bang",
            1
          ],
          "destination": [
            "identity-press",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "identity-press",
            0
          ],
          "destination": [
            "new-identity",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "new-identity",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "live-ready",
            0
          ],
          "destination": [
            "live-ready-order",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "from-node",
            0
          ],
          "destination": [
            "node-ready-order",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "live-ready-order",
            1
          ],
          "destination": [
            "live-ready-flag",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "live-ready-order",
            0
          ],
          "destination": [
            "node-ready-flag",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "node-ready-order",
            1
          ],
          "destination": [
            "node-ready-flag",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "node-ready-order",
            0
          ],
          "destination": [
            "live-ready-flag",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "node-ready-flag",
            0
          ],
          "destination": [
            "both-ready-live",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "live-ready-flag",
            0
          ],
          "destination": [
            "both-ready-node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-1",
            0
          ],
          "destination": [
            "macro-1-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-1-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-2",
            0
          ],
          "destination": [
            "macro-2-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-2-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-3",
            0
          ],
          "destination": [
            "macro-3-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-3-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-4",
            0
          ],
          "destination": [
            "macro-4-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-4-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-5",
            0
          ],
          "destination": [
            "macro-5-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-5-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-6",
            0
          ],
          "destination": [
            "macro-6-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-6-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-7",
            0
          ],
          "destination": [
            "macro-7-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-7-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-8",
            0
          ],
          "destination": [
            "macro-8-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "macro-8-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "midi-in",
            0
          ],
          "destination": [
            "midi-out",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "midi-in",
            0
          ],
          "destination": [
            "midi-defer",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "midi-defer",
            0
          ],
          "destination": [
            "midi-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "midi-send",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "both-ready-live",
            0
          ],
          "destination": [
            "replay",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "both-ready-node",
            0
          ],
          "destination": [
            "replay",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            11
          ],
          "destination": [
            "source-id",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            10
          ],
          "destination": [
            "source-name",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            9
          ],
          "destination": [
            "port",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            8
          ],
          "destination": [
            "macro-1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            7
          ],
          "destination": [
            "macro-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            6
          ],
          "destination": [
            "macro-3",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            5
          ],
          "destination": [
            "macro-4",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            4
          ],
          "destination": [
            "macro-5",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            3
          ],
          "destination": [
            "macro-6",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            2
          ],
          "destination": [
            "macro-7",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            1
          ],
          "destination": [
            "macro-8",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "replay",
            0
          ],
          "destination": [
            "start",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "start",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "close",
            0
          ],
          "destination": [
            "dispose",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "dispose",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      }
    ],
    "parameters": {
      "source-id": [
        "LEDrums Source ID",
        "LEDrums Source ID",
        0
      ],
      "source-name": [
        "LEDrums Source Name",
        "LEDrums Source Name",
        0
      ],
      "port": [
        "LEDrums UDP Port",
        "UDP Port",
        0
      ],
      "macro-1": [
        "LEDrums Macro 1",
        "Macro 1",
        0
      ],
      "macro-2": [
        "LEDrums Macro 2",
        "Macro 2",
        0
      ],
      "macro-3": [
        "LEDrums Macro 3",
        "Macro 3",
        0
      ],
      "macro-4": [
        "LEDrums Macro 4",
        "Macro 4",
        0
      ],
      "macro-5": [
        "LEDrums Macro 5",
        "Macro 5",
        0
      ],
      "macro-6": [
        "LEDrums Macro 6",
        "Macro 6",
        0
      ],
      "macro-7": [
        "LEDrums Macro 7",
        "Macro 7",
        0
      ],
      "macro-8": [
        "LEDrums Macro 8",
        "Macro 8",
        0
      ],
      "parameterbanks": {
        "0": {
          "index": 0,
          "name": "LEDrums macros",
          "parameters": [
            "macro-1",
            "macro-2",
            "macro-3",
            "macro-4",
            "macro-5",
            "macro-6",
            "macro-7",
            "macro-8"
          ]
        }
      }
    },
    "dependency_cache": [
      {
        "name": "max-bridge.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "device-runtime.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "packets.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "midi.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "audio.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "session.cjs",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "udp.cjs",
        "type": "TEXT",
        "implicit": 1
      }
    ],
    "autosave": 0
  }
}
