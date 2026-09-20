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
    "boxes": [
      {
        "box": {
          "id": "title",
          "maxclass": "comment",
          "text": "LEDrums Audio",
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
            "LEDrums Audio"
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Source Name",
              "parameter_shortname": "LEDrums Source Name",
              "parameter_type": 3,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                "LEDrums Audio"
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "name-editor",
          "maxclass": "textedit",
          "text": "LEDrums Audio",
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
          "id": "gain-label",
          "maxclass": "comment",
          "text": "Gain",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            95,
            115,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            95,
            115,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "gain",
          "maxclass": "live.numbox",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            490,
            116,
            100,
            22
          ],
          "varname": "gain",
          "presentation": 1,
          "presentation_rect": [
            490,
            116,
            100,
            22
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Gain",
              "parameter_shortname": "Gain",
              "parameter_type": 0,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                1
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 4
            }
          }
        }
      },
      {
        "box": {
          "id": "gain-send",
          "maxclass": "newobj",
          "text": "prepend analysis gain",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            490,
            546,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "floorDb-label",
          "maxclass": "comment",
          "text": "Floor dB",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            610,
            95,
            115,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            610,
            95,
            115,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "floorDb",
          "maxclass": "live.numbox",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            610,
            116,
            100,
            22
          ],
          "varname": "floorDb",
          "presentation": 1,
          "presentation_rect": [
            610,
            116,
            100,
            22
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Floor dB",
              "parameter_shortname": "Floor dB",
              "parameter_type": 0,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                -60
              ],
              "parameter_mmin": -90,
              "parameter_mmax": -20
            }
          }
        }
      },
      {
        "box": {
          "id": "floorDb-send",
          "maxclass": "newobj",
          "text": "prepend analysis floorDb",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            610,
            546,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "attackMs-label",
          "maxclass": "comment",
          "text": "Attack ms",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            730,
            95,
            115,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            730,
            95,
            115,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "attackMs",
          "maxclass": "live.numbox",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            730,
            116,
            100,
            22
          ],
          "varname": "attackMs",
          "presentation": 1,
          "presentation_rect": [
            730,
            116,
            100,
            22
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Attack ms",
              "parameter_shortname": "Attack ms",
              "parameter_type": 0,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                15
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1000
            }
          }
        }
      },
      {
        "box": {
          "id": "attackMs-send",
          "maxclass": "newobj",
          "text": "prepend analysis attackMs",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            730,
            546,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "releaseMs-label",
          "maxclass": "comment",
          "text": "Release ms",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            850,
            95,
            115,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            850,
            95,
            115,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "releaseMs",
          "maxclass": "live.numbox",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            850,
            116,
            100,
            22
          ],
          "varname": "releaseMs",
          "presentation": 1,
          "presentation_rect": [
            850,
            116,
            100,
            22
          ],
          "parameter_enable": 1,
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "LEDrums Release ms",
              "parameter_shortname": "Release ms",
              "parameter_type": 0,
              "parameter_invisible": 1,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                180
              ],
              "parameter_mmin": 0,
              "parameter_mmax": 1000
            }
          }
        }
      },
      {
        "box": {
          "id": "releaseMs-send",
          "maxclass": "newobj",
          "text": "prepend analysis releaseMs",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            850,
            546,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "path-hint",
          "maxclass": "comment",
          "text": "Stereo passes directly. Analysis only: Level / Bass / Mids / Highs, ≤30 Hz.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            490,
            145,
            540,
            18
          ],
          "presentation": 1,
          "presentation_rect": [
            490,
            145,
            540,
            18
          ],
          "fontsize": 11
        }
      },
      {
        "box": {
          "id": "audio-in",
          "maxclass": "newobj",
          "text": "plugin~",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            20,
            660,
            70,
            22
          ]
        }
      },
      {
        "box": {
          "id": "audio-out",
          "maxclass": "newobj",
          "text": "plugout~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            20,
            940,
            75,
            22
          ]
        }
      },
      {
        "box": {
          "id": "dsp-state",
          "maxclass": "newobj",
          "text": "dspstate~",
          "numinlets": 1,
          "numoutlets": 3,
          "patching_rect": [
            1040,
            660,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "dsp-send",
          "maxclass": "newobj",
          "text": "prepend dsp",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            1040,
            700,
            115,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-size",
          "maxclass": "newobj",
          "text": "expr max(1\\, min(19200\\, int($f1 * 0.02)))",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            1040,
            740,
            310,
            22
          ]
        }
      },
      {
        "box": {
          "id": "high-cutoff",
          "maxclass": "newobj",
          "text": "expr min(12000.\\, $f1 * 0.45)",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            1040,
            780,
            250,
            22
          ]
        }
      },
      {
        "box": {
          "id": "sample-clock",
          "maxclass": "newobj",
          "text": "qmetro 34",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1040,
            820,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "sample-order",
          "maxclass": "newobj",
          "text": "t b b b b b b b b",
          "numinlets": 1,
          "numoutlets": 8,
          "patching_rect": [
            1040,
            860,
            210,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-pack",
          "maxclass": "newobj",
          "text": "pack f f f f f f f f",
          "numinlets": 8,
          "numoutlets": 1,
          "patching_rect": [
            560,
            940,
            190,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-send",
          "maxclass": "newobj",
          "text": "prepend rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            560,
            980,
            110,
            22
          ]
        }
      },
      {
        "box": {
          "id": "sub-0",
          "maxclass": "newobj",
          "text": "cross~ 20",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            150,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "bass-0",
          "maxclass": "newobj",
          "text": "cross~ 250",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            250,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "mids-0",
          "maxclass": "newobj",
          "text": "cross~ 2000",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            350,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "highs-0",
          "maxclass": "newobj",
          "text": "cross~ 12000",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            450,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-0",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-0",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-2",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            250,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-2",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            250,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-4",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            350,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-4",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            350,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-6",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            450,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-6",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            450,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "sub-1",
          "maxclass": "newobj",
          "text": "cross~ 20",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            580,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "bass-1",
          "maxclass": "newobj",
          "text": "cross~ 250",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            680,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "mids-1",
          "maxclass": "newobj",
          "text": "cross~ 2000",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            780,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "highs-1",
          "maxclass": "newobj",
          "text": "cross~ 12000",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            880,
            700,
            95,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-1",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            580,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-1",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            580,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-3",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            680,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-3",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            680,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-5",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            780,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-5",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            780,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "rms-7",
          "maxclass": "newobj",
          "text": "average~ 960 rms",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            880,
            780,
            130,
            22
          ]
        }
      },
      {
        "box": {
          "id": "snapshot-7",
          "maxclass": "newobj",
          "text": "snapshot~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            880,
            860,
            90,
            22
          ]
        }
      },
      {
        "box": {
          "id": "replay",
          "maxclass": "newobj",
          "text": "t b b b b b b b b b b b b b b b b b",
          "numinlets": 1,
          "numoutlets": 17,
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
          "text": "start audio",
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
            "gain",
            0
          ],
          "destination": [
            "gain-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "gain-send",
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
            "floorDb",
            0
          ],
          "destination": [
            "floorDb-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "floorDb-send",
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
            "attackMs",
            0
          ],
          "destination": [
            "attackMs-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "attackMs-send",
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
            "releaseMs",
            0
          ],
          "destination": [
            "releaseMs-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "releaseMs-send",
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
            "audio-in",
            0
          ],
          "destination": [
            "audio-out",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "audio-in",
            1
          ],
          "destination": [
            "audio-out",
            1
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "dsp-state",
            0
          ],
          "destination": [
            "sample-clock",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "dsp-state",
            0
          ],
          "destination": [
            "dsp-send",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "dsp-send",
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
            "dsp-state",
            1
          ],
          "destination": [
            "rms-size",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "dsp-state",
            1
          ],
          "destination": [
            "high-cutoff",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "sample-clock",
            0
          ],
          "destination": [
            "sample-order",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "rms-pack",
            0
          ],
          "destination": [
            "rms-send",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "rms-send",
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
            "audio-in",
            0
          ],
          "destination": [
            "sub-0",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "sub-0",
            1
          ],
          "destination": [
            "bass-0",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "bass-0",
            1
          ],
          "destination": [
            "mids-0",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "mids-0",
            1
          ],
          "destination": [
            "highs-0",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "high-cutoff",
            0
          ],
          "destination": [
            "highs-0",
            1
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "audio-in",
            0
          ],
          "destination": [
            "rms-0",
            0
          ],
          "order": 2
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-0",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-0",
            0
          ],
          "destination": [
            "snapshot-0",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            0
          ],
          "destination": [
            "snapshot-0",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-0",
            0
          ],
          "destination": [
            "rms-pack",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "bass-0",
            0
          ],
          "destination": [
            "rms-2",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-2",
            0
          ],
          "order": 2
        }
      },
      {
        "patchline": {
          "source": [
            "rms-2",
            0
          ],
          "destination": [
            "snapshot-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            2
          ],
          "destination": [
            "snapshot-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-2",
            0
          ],
          "destination": [
            "rms-pack",
            2
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "mids-0",
            0
          ],
          "destination": [
            "rms-4",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-4",
            0
          ],
          "order": 4
        }
      },
      {
        "patchline": {
          "source": [
            "rms-4",
            0
          ],
          "destination": [
            "snapshot-4",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            4
          ],
          "destination": [
            "snapshot-4",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-4",
            0
          ],
          "destination": [
            "rms-pack",
            4
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "highs-0",
            0
          ],
          "destination": [
            "rms-6",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-6",
            0
          ],
          "order": 6
        }
      },
      {
        "patchline": {
          "source": [
            "rms-6",
            0
          ],
          "destination": [
            "snapshot-6",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            6
          ],
          "destination": [
            "snapshot-6",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-6",
            0
          ],
          "destination": [
            "rms-pack",
            6
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "audio-in",
            1
          ],
          "destination": [
            "sub-1",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "sub-1",
            1
          ],
          "destination": [
            "bass-1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "bass-1",
            1
          ],
          "destination": [
            "mids-1",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "mids-1",
            1
          ],
          "destination": [
            "highs-1",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "high-cutoff",
            0
          ],
          "destination": [
            "highs-1",
            1
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "audio-in",
            1
          ],
          "destination": [
            "rms-1",
            0
          ],
          "order": 2
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-1",
            0
          ],
          "order": 1
        }
      },
      {
        "patchline": {
          "source": [
            "rms-1",
            0
          ],
          "destination": [
            "snapshot-1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            1
          ],
          "destination": [
            "snapshot-1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-1",
            0
          ],
          "destination": [
            "rms-pack",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "bass-1",
            0
          ],
          "destination": [
            "rms-3",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-3",
            0
          ],
          "order": 3
        }
      },
      {
        "patchline": {
          "source": [
            "rms-3",
            0
          ],
          "destination": [
            "snapshot-3",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            3
          ],
          "destination": [
            "snapshot-3",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-3",
            0
          ],
          "destination": [
            "rms-pack",
            3
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "mids-1",
            0
          ],
          "destination": [
            "rms-5",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-5",
            0
          ],
          "order": 5
        }
      },
      {
        "patchline": {
          "source": [
            "rms-5",
            0
          ],
          "destination": [
            "snapshot-5",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            5
          ],
          "destination": [
            "snapshot-5",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-5",
            0
          ],
          "destination": [
            "rms-pack",
            5
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "highs-1",
            0
          ],
          "destination": [
            "rms-7",
            0
          ],
          "order": 0
        }
      },
      {
        "patchline": {
          "source": [
            "rms-size",
            0
          ],
          "destination": [
            "rms-7",
            0
          ],
          "order": 7
        }
      },
      {
        "patchline": {
          "source": [
            "rms-7",
            0
          ],
          "destination": [
            "snapshot-7",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "sample-order",
            7
          ],
          "destination": [
            "snapshot-7",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "snapshot-7",
            0
          ],
          "destination": [
            "rms-pack",
            7
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
            16
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
            15
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
            14
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
            13
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
            12
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
            11
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
            10
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
            9
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
            8
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
            7
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
            6
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
            5
          ],
          "destination": [
            "gain",
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
            "floorDb",
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
            "attackMs",
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
            "releaseMs",
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
            "dsp-state",
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
      "gain": [
        "LEDrums Gain",
        "Gain",
        0
      ],
      "floorDb": [
        "LEDrums Floor dB",
        "Floor dB",
        0
      ],
      "attackMs": [
        "LEDrums Attack ms",
        "Attack ms",
        0
      ],
      "releaseMs": [
        "LEDrums Release ms",
        "Release ms",
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
    "autosave": 0,
    "latency": 0,
    "is_mpe": 0,
    "external_mpe_tuning_enabled": 0,
    "minimum_live_version": "",
    "minimum_max_version": "",
    "platform_compatibility": 0,
    "project": {
      "version": 1,
      "creationdate": 3872707200,
      "modificationdate": 3872707200,
      "viewrect": [
        0,
        0,
        300,
        500
      ],
      "autoorganize": 1,
      "hideprojectwindow": 1,
      "showdependencies": 1,
      "autolocalize": 0,
      "contents": {
        "patchers": {}
      },
      "layout": {},
      "searchpath": {},
      "detailsvisible": 0,
      "amxdtype": 1633771873,
      "readonly": 0,
      "devpathtype": 0,
      "devpath": ".",
      "sortmode": 0,
      "viewmode": 0,
      "includepackages": 0
    },
    "saved_attribute_attributes": {
      "default_plcolor": {
        "expression": ""
      }
    }
  }
}
