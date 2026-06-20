<script lang="ts">
  import { SLOT_LABELS, type InputMap } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';
  import InputMonitor from '../panels/InputMonitor.svelte';

  let draft = $state<InputMap>({ midiNotes: [], oscMap: [] });
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const project = $derived(store.project);
  const drums = $derived(project?.kit.drums ?? []);

  $effect(() => {
    if (project) draft = structuredClone(project.inputMap);
  });

  function commit(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => store.setInputMap(structuredClone(draft)), 180);
  }

  function addMidi(): void {
    draft.midiNotes = [
      ...draft.midiNotes,
      { note: 36, drumId: drums[0]?.id ?? '', slot: 0 },
    ];
    commit();
  }

  function addOsc(): void {
    draft.oscMap = [
      ...draft.oscMap,
      { address: '/sp/hit', drumId: drums[0]?.id ?? '', slot: 0 },
    ];
    commit();
  }

  function setVolumeAddress(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value.trim();
    draft.volumeOscAddress = value || undefined;
    commit();
  }
</script>

<section class="map">
  <div class="tables">
    <section class="panel">
      <div class="panel-head">
        <h2>MIDI Map</h2>
        <button onclick={addMidi}>Add</button>
      </div>
      <table>
        <thead>
          <tr><th>Note</th><th>Drum</th><th>Slot</th><th></th></tr>
        </thead>
        <tbody>
          {#each draft.midiNotes as row, index (index)}
            <tr>
              <td>
                <input
                  type="number"
                  min="0"
                  max="127"
                  value={row.note}
                  oninput={(event) => {
                    row.note = Math.max(0, Math.min(127, Number((event.currentTarget as HTMLInputElement).value)));
                    commit();
                  }}
                />
              </td>
              <td>
                <select bind:value={row.drumId} onchange={commit}>
                  {#each drums as drum (drum.id)}
                    <option value={drum.id}>{drum.label}</option>
                  {/each}
                </select>
              </td>
              <td>
                <select bind:value={row.slot} onchange={commit}>
                  {#each SLOT_LABELS as label, slot (slot)}
                    <option value={slot}>{label}</option>
                  {/each}
                </select>
              </td>
              <td><button class="danger" onclick={() => { draft.midiNotes.splice(index, 1); commit(); }}>Remove</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>OSC Map</h2>
        <button onclick={addOsc}>Add</button>
      </div>
      <label class="volume">
        <span>Volume OSC address</span>
        <input
          value={draft.volumeOscAddress ?? ''}
          placeholder="/ableton/master/volume"
          spellcheck="false"
          oninput={setVolumeAddress}
        />
      </label>
      <table>
        <thead>
          <tr><th>Address</th><th>Drum</th><th>Slot</th><th></th></tr>
        </thead>
        <tbody>
          {#each draft.oscMap as row, index (index)}
            <tr>
              <td>
                <input
                  value={row.address}
                  spellcheck="false"
                  oninput={(event) => { row.address = (event.currentTarget as HTMLInputElement).value; commit(); }}
                />
              </td>
              <td>
                <select bind:value={row.drumId} onchange={commit}>
                  {#each drums as drum (drum.id)}
                    <option value={drum.id}>{drum.label}</option>
                  {/each}
                </select>
              </td>
              <td>
                <select bind:value={row.slot} onchange={commit}>
                  {#each SLOT_LABELS as label, slot (slot)}
                    <option value={slot}>{label}</option>
                  {/each}
                </select>
              </td>
              <td><button class="danger" onclick={() => { draft.oscMap.splice(index, 1); commit(); }}>Remove</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>

  <aside class="panel monitor">
    <div class="panel-head"><h2>Input Monitor</h2></div>
    <InputMonitor />
  </aside>
</section>

<style>
  .map {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 10px;
    min-height: 0;
  }
  .tables {
    display: grid;
    gap: 10px;
    min-width: 0;
    overflow: auto;
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    min-width: 0;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 0;
    flex: 1;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--accent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
    padding: 6px;
    text-align: left;
  }
  th {
    color: var(--text-dim);
    font-size: 10px;
    text-transform: uppercase;
  }
  input,
  select {
    width: 100%;
  }
  td:first-child {
    width: 34%;
  }
  td:last-child {
    width: 76px;
  }
  .volume {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--text-dim);
  }
  .monitor {
    overflow: auto;
  }
</style>
