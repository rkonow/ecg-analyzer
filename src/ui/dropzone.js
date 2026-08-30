// Dropzone: drag-and-drop plus click-to-browse for exactly one image file.

export function createDropzone(root, { onFile }) {
  const input = root.querySelector("input[type=file]");

  function pickFirstFile(fileList) {
    if (!fileList || fileList.length === 0) return null;
    return fileList[0];
  }

  function openPicker() {
    input.value = "";
    input.click();
  }

  root.addEventListener("click", openPicker);

  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  input.addEventListener("change", () => {
    const file = pickFirstFile(input.files);
    if (file) onFile(file);
  });

  let dragDepth = 0;

  root.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    root.dataset.drag = "over";
  });

  root.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  root.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) delete root.dataset.drag;
  });

  root.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    delete root.dataset.drag;
    const file = pickFirstFile(event.dataTransfer && event.dataTransfer.files);
    if (file) onFile(file);
  });

  return {
    reset() {
      input.value = "";
    },
  };
}
