import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import Home from "./Home"

describe("Home page", () => {
  it("renders the landing page hero and primary navigation", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(screen.getAllByText("Safascord")[0]).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /a place to talk, build, and stay in sync/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open safascord/i })).toHaveAttribute("href", "/channels/@me")
    expect(screen.getByRole("link", { name: /discover servers/i })).toHaveAttribute("href", "/discover")
  })
})
