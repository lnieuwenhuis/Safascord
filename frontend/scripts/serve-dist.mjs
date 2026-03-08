import http from "node:http"
import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, "../dist")
const distDirPrefix = `${distDir}${path.sep}`
const indexPath = path.join(distDir, "index.html")
const port = Number(process.env.PORT || 3000)

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const isHtml = ext === ".html"

  res.writeHead(200, {
    "Content-Type": contentTypes.get(ext) || "application/octet-stream",
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
  })

  createReadStream(filePath).pipe(res)
}

function resolveDistPath(requestPathname) {
  const relativePath = requestPathname.replace(/^[/\\]+/, "")
  const resolvedPath = path.resolve(distDir, relativePath)
  const isInsideDist = resolvedPath === distDir || resolvedPath.startsWith(distDirPrefix)

  return isInsideDist ? resolvedPath : null
}

const server = http.createServer(async (req, res) => {
  let filePath

  try {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1")
      const requestedPath = decodeURIComponent(url.pathname)
      filePath = resolveDistPath(requestedPath)
    } catch (error) {
      if (error instanceof TypeError || error instanceof URIError) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        res.end("Bad request")
        return
      }

      throw error
    }

    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Forbidden")
      return
    }

    const fileStat = await stat(filePath).catch(() => null)

    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html")
    }

    if (existsSync(filePath) && (await stat(filePath)).isFile()) {
      sendFile(res, filePath)
      return
    }

    if (existsSync(indexPath)) {
      sendFile(res, indexPath)
      return
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Not found")
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Internal server error")
  }
})

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving ${distDir} on http://0.0.0.0:${port}`)
})
