<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h2>Data Source</h2>
        <button class="close-btn" @click="$emit('close')">x</button>
      </div>

      <p class="modal-description">
        This build uses Microsoft Planetary Computer directly. Sentinel-2 L2A scenes are discovered through the public STAC API, map tiles are rendered through the Planetary Computer TiTiler endpoint, and chart values are sampled from the same items.
      </p>

      <div class="endpoint-list">
        <div>
          <span>STAC</span>
          <code>https://planetarycomputer.microsoft.com/api/stac/v1</code>
        </div>
        <div>
          <span>Tiles</span>
          <code>https://planetarycomputer.microsoft.com/api/data/v1</code>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ close: [] }>()
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--bg);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 24px;
  width: 520px;
  max-width: 90vw;
  color: var(--text);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text);
}

.modal-description {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 20px;
  line-height: 1.5;
}

.endpoint-list {
  display: grid;
  gap: 10px;
}

.endpoint-list div {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 12px;
}

.endpoint-list span {
  color: var(--text-sub);
  font-size: 0.82rem;
  font-weight: 600;
}

.endpoint-list code {
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.78rem;
  padding: 7px 9px;
  overflow-wrap: anywhere;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 8px 16px;
}

.btn-primary {
  background: var(--accent);
  color: var(--bg);
  font-weight: 600;
}

.btn-primary:hover {
  background: color-mix(in srgb, var(--accent) 80%, white);
}
</style>
