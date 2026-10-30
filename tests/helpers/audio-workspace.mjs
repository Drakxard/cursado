export function installAudioWorkspace() {
    window.workspaceFiles = new Map(JSON.parse(sessionStorage.getItem("test-workspace") ?? "[]").map(([path, bytes]) => [path, new Blob([new Uint8Array(bytes)])]))
    window.failWorkspaceWrites = false
    window.workspacePermission = "granted"
    const missing = () => new DOMException("Missing", "NotFoundError")
    const directory = (prefix = "") => ({
      queryPermission: async () => window.workspacePermission,
      getDirectoryHandle: async (name, { create = false } = {}) => {
        const path = prefix + name + "/"
        if (!create && ![...window.workspaceFiles.keys()].some((key) => key.startsWith(path))) throw missing()
        return directory(path)
      },
      getFileHandle: async (name, { create = false } = {}) => {
        const path = prefix + name
        if (!create && !window.workspaceFiles.has(path)) throw missing()
        return {
          getFile: async () => {
            if (!window.workspaceFiles.has(path)) throw missing()
            return new File([window.workspaceFiles.get(path)], name)
          },
          createWritable: async () => {
            let content
            return {
              write: async (value) => {
                if (window.holdWorkspaceWrites) {
                  window.writeStarted = true
                  await new Promise((resolve) => { window.releaseWorkspaceWrite = resolve })
                }
                if (window.failWorkspaceWrites || window.failWritePath === path || (window.failImageName && value instanceof File && value.name === window.failImageName)) throw new Error("Disco lleno")
                content = value instanceof Blob ? value : new Blob([value])
              },
              close: async () => {
                window.workspaceFiles.set(path, content)
                sessionStorage.setItem("test-workspace", JSON.stringify(await Promise.all([...window.workspaceFiles].map(async ([key, blob]) => [key, Array.from(new Uint8Array(await blob.arrayBuffer()))]))))
              },
              abort: async () => {},
            }
          },
        }
      },
    })
    window.workspaceRoot = directory()

}
