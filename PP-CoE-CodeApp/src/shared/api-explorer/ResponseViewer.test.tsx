import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ResponseViewer } from "./ResponseViewer";

function renderViewer(text = '{"name":"Example","other":"example"}') {
  return render(<FluentProvider theme={webLightTheme}>
    <ResponseViewer sources={[
      { label: "Response body", ariaLabel: "Test response", text },
      { label: "Raw flow response", ariaLabel: "Raw response", text: "EXAMPLE" },
    ]} />
  </FluentProvider>);
}

describe("ResponseViewer", () => {
  it("preserves all response text and highlights literal case-insensitive matches", () => {
    renderViewer();
    const response = screen.getByLabelText("Test response");
    const original = response.textContent;
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: "example" } });
    expect(response.textContent).toBe(original);
    expect(response.querySelectorAll("mark")).toHaveLength(2);
    expect(response.querySelector('[aria-current="true"]')).toHaveTextContent("Example");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  });
  it("navigates and wraps matches using buttons and keyboard", () => {
    renderViewer();
    const search = screen.getByRole("textbox", { name: "Search response" });
    fireEvent.change(search, { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
    fireEvent.keyDown(search, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByLabelText("Test response").querySelectorAll("mark")).toHaveLength(0);
  });
  it("keeps the response visible for no matches and searches raw output independently", () => {
    renderViewer();
    const search = screen.getByRole("textbox", { name: "Search response" });
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
    expect(screen.getByLabelText("Test response")).toHaveTextContent("Example");
    fireEvent.change(search, { target: { value: "example" } });
    fireEvent.click(screen.getByRole("tab", { name: "Raw flow response" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 1");
    expect(screen.getByLabelText("Raw response").querySelector("mark")).toHaveTextContent("EXAMPLE");
    fireEvent.click(screen.getByRole("button", { name: "Clear response search" }));
    expect(search).toHaveValue("");
  });
  it("renders untrusted response content as text, never as HTML", () => {
    renderViewer('<script>alert("x")</script>.*');
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: ".*" } });
    const response = screen.getByLabelText("Test response");
    expect(response.querySelector("script")).toBeNull();
    expect(response.querySelector("mark")).toHaveTextContent(".*");
    fireEvent.click(screen.getByRole("checkbox", { name: "Wrap lines" }));
    expect(screen.getByRole("checkbox", { name: "Wrap lines" })).not.toBeChecked();
  });
});
