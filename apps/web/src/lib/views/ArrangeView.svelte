<script lang="ts">
  import { SLOT_LABELS, type Clip, type Layer, type Section, type Song } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';
  import { bindingFor, describeBinding, makeId, selectedLayerClip } from './arrange-helpers';

  let selectedSongId = $state<string | null>(null);
  let selectedSectionId = $state<string | null>(null);

  const project = $derived(store.project);
  const songs = $derived(project?.setlist.songs ?? []);
  const layers = $derived(project?.composition.layers ?? []);
  const drums = $derived(project?.kit.drums ?? []);
  const selectedSong = $derived(songs.find((song) => song.id === selectedSongId) ?? songs[0] ?? null);
  const selectedSection = $derived(
    selectedSong?.sections.find((section) => section.id === selectedSectionId) ??
      selectedSong?.sections[0] ??
      null,
  );
  const activeSong = $derived(songs.find((song) => song.id === project?.setlist.activeSongId) ?? null);
  const activeSection = $derived(
    activeSong?.sections.find((section) => section.id === project?.setlist.activeSectionId) ?? null,
  );

  $effect(() => {
    if (!selectedSongId || !songs.some((song) => song.id === selectedSongId)) {
      selectedSongId = songs[0]?.id ?? null;
    }
  });

  $effect(() => {
    if (!selectedSong) {
      selectedSectionId = null;
      return;
    }
    if (!selectedSectionId || !selectedSong.sections.some((section) => section.id === selectedSectionId)) {
      selectedSectionId = selectedSong.sections[0]?.id ?? null;
    }
  });

  function addSong(): void {
    const next = songs.length + 1;
    const song: Song = { id: makeId('song'), name: `Song ${next}`, sections: [] };
    store.addSong(song);
    selectedSongId = song.id;
  }

  function addSection(): void {
    if (!selectedSong) return;
    const next = selectedSong.sections.length + 1;
    const section: Section = {
      id: makeId('section'),
      name: `Section ${next}`,
      layerClips: [],
      bindings: [],
    };
    store.addSection(selectedSong.id, section);
    selectedSectionId = section.id;
  }

  function goLive(): void {
    if (selectedSong && selectedSection) store.setActiveSection(selectedSong.id, selectedSection.id);
  }

  function setCell(section: Section, drumId: string, slot: number, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) {
      store.removeBinding(section.id, drumId, slot);
      return;
    }
    const [layerId, clipId] = value.split('|');
    if (layerId && clipId) store.setBinding(section.id, { drumId, slot, layerId, clipId });
  }

  function cellValue(section: Section, drumId: string, slot: number): string {
    const binding = bindingFor(section.bindings, drumId, slot);
    return binding ? `${binding.layerId}|${binding.clipId}` : '';
  }

  function setLayerLook(section: Section, layer: Layer, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    store.setSectionLayerClip(section.id, layer.id, value === '' ? null : value);
  }

  function clipOptions(): Array<{ layer: Layer; clip: Clip }> {
    return layers.flatMap((layer) => layer.clips.map((clip) => ({ layer, clip })));
  }
</script>

<section class="arrange">
  <div class="live">
    <span>ACTIVE</span>
    <strong>{activeSong?.name ?? 'No song'} -> {activeSection?.name ?? 'No section'}</strong>
    <button class="primary" onclick={goLive} disabled={!selectedSong || !selectedSection}>Go Live</button>
  </div>

  <div class="panes">
    <aside class="panel list">
      <div class="panel-head">
        <h2>Setlist</h2>
        <button onclick={addSong}>Add</button>
      </div>
      {#if songs.length === 0}
        <p class="empty">No songs.</p>
      {:else}
        {#each songs as song (song.id)}
          <button
            class="row"
            class:active={song.id === selectedSong?.id}
            onclick={() => (selectedSongId = song.id)}
          >
            <span>{song.name || song.id}</span>
            <small>{song.sections.length} sections</small>
          </button>
        {/each}
      {/if}
      {#if selectedSong}
        <button class="danger" onclick={() => store.removeSong(selectedSong.id)}>Remove Song</button>
      {/if}
    </aside>

    <aside class="panel list">
      <div class="panel-head">
        <h2>Song</h2>
        <button onclick={addSection} disabled={!selectedSong}>Add</button>
      </div>
      {#if !selectedSong}
        <p class="empty">Select a song.</p>
      {:else if selectedSong.sections.length === 0}
        <p class="empty">No sections.</p>
      {:else}
        {#each selectedSong.sections as section (section.id)}
          <button
            class="row"
            class:active={section.id === selectedSection?.id}
            onclick={() => (selectedSectionId = section.id)}
          >
            <span>{section.name || section.id}</span>
            <small>{section.bars ? `${section.bars} bars` : 'open'}</small>
          </button>
        {/each}
      {/if}
      {#if selectedSong && selectedSection}
        <button class="danger" onclick={() => store.removeSection(selectedSong.id, selectedSection.id)}>
          Remove Section
        </button>
      {/if}
    </aside>

    <main class="editor">
      {#if !selectedSection}
        <div class="panel empty-panel">Add or select a section to edit trigger routing.</div>
      {:else}
        <section class="panel">
          <div class="panel-head">
            <h2>Trigger Binding Matrix</h2>
            <span class="hint">{selectedSong?.name} / {selectedSection.name}</span>
          </div>
          <div class="matrix-wrap">
            <table class="matrix">
              <thead>
                <tr>
                  <th>Drum</th>
                  {#each SLOT_LABELS as label (label)}
                    <th>{label}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each drums as drum (drum.id)}
                  <tr>
                    <th>{drum.label}</th>
                    {#each SLOT_LABELS as _label, slot (slot)}
                      {@const binding = bindingFor(selectedSection.bindings, drum.id, slot)}
                      <td title={describeBinding(binding, layers)}>
                        <select
                          value={cellValue(selectedSection, drum.id, slot)}
                          onchange={(event) => setCell(selectedSection, drum.id, slot, event)}
                        >
                          <option value="">Empty</option>
                          {#each clipOptions() as option (`${option.layer.id}-${option.clip.id}`)}
                            <option value={`${option.layer.id}|${option.clip.id}`}>
                              {option.layer.name || option.layer.id} -> {option.clip.name || option.clip.effectId}
                            </option>
                          {/each}
                        </select>
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel looks">
          <div class="panel-head">
            <h2>Layer Looks</h2>
            <span class="hint">Loaded when this section becomes active</span>
          </div>
          <div class="look-grid">
            {#each layers as layer (layer.id)}
              <label>
                <span>{layer.name || layer.id}</span>
                <select
                  value={selectedLayerClip(selectedSection, layer.id)}
                  onchange={(event) => setLayerLook(selectedSection, layer, event)}
                >
                  <option value="">No change</option>
                  {#each layer.clips as clip (clip.id)}
                    <option value={clip.id}>{clip.name || clip.effectId}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
        </section>
      {/if}
    </main>
  </div>
</section>

<style>
  .arrange {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 10px;
    min-height: 0;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid #743131;
    background: rgba(70, 18, 18, 0.72);
    box-shadow: 0 0 18px var(--live-glow);
  }
  .live span {
    color: var(--live);
    font-weight: 800;
    font-size: 11px;
  }
  .live strong {
    flex: 1;
    font-size: 15px;
  }
  .panes {
    display: grid;
    grid-template-columns: 210px 230px minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
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
  .hint,
  small,
  .empty {
    color: var(--text-dim);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    overflow: auto;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
  }
  .editor {
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .matrix-wrap {
    overflow: auto;
  }
  .matrix {
    width: 100%;
    min-width: 980px;
    border-collapse: collapse;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
    padding: 6px;
    text-align: left;
    vertical-align: middle;
  }
  th {
    color: var(--text-dim);
    font-size: 10px;
    text-transform: uppercase;
  }
  td select {
    width: 132px;
  }
  .looks {
    flex: 0 0 auto;
  }
  .look-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
  }
  .look-grid label {
    display: grid;
    gap: 4px;
    color: var(--text-dim);
  }
  .empty-panel {
    color: var(--text-dim);
  }
</style>
