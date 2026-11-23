import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ResponseViewer } from "./ResponseViewer";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

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

  it("copies the complete selected response without search markup and resets feedback between tabs", async () => {
    const text = '{"name":"Example","other":"example"}';
    renderViewer(text);
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: "example" } });
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
    await screen.findByText("Copied to clipboard.");
    expect(writeText).toHaveBeenLastCalledWith(text);
    fireEvent.click(screen.getByRole("tab", { name: "Raw flow response" }));
    expect(screen.queryByText("Copied to clipboard.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
    await screen.findByText("Copied to clipboard.");
    expect(writeText).toHaveBeenLastCalledWith("EXAMPLE");
  });

  it("keeps headers and the submitted snapshot collapsed and copies their exact JSON independently", async () => {
    const headers = { Location: "/operations/example", "Retry-After": "10", ETag: 'W/"9"' };
    const request = { method: "POST", body: { granularity: "Summary" } };
    render(<FluentProvider theme={webLightTheme}>
      <ResponseViewer sources={[{ label: "Body", ariaLabel: "Body", text: "{}" }]}
        headers={headers} request={{ label: "Submitted request", text: JSON.stringify(request, null, 2) }} />
    </FluentProvider>);
    expect(screen.getByText("Response headers").parentElement).not.toHaveAttribute("open");
    expect(screen.getByText("Submitted request").parentElement).not.toHaveAttribute("open");
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Response headers"));
    expect(screen.getByLabelText("Response headers JSON")).toHaveTextContent("/operations/example");
    fireEvent.click(screen.getByRole("button", { name: "Copy response headers" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(headers, null, 2)));
    fireEvent.click(screen.getByText("Submitted request"));
    fireEvent.click(screen.getByRole("button", { name: "Copy submitted request" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(request, null, 2)));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unavailable headers from an exposed empty collection", () => {
    const { rerender } = render(<ResponseViewer sources={[]} />);
    expect(screen.getByText(/No response headers were exposed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy response headers", hidden: true })).not.toBeInTheDocument();
    rerender(<ResponseViewer sources={[]} headers={new Headers({ Location: "/operations/example" })} />);
    expect(screen.getByLabelText("Response headers JSON")).toHaveTextContent('"location": "/operations/example"');
    rerender(<ResponseViewer sources={[]} headers={{}} />);
    expect(screen.getByLabelText("Response headers JSON")).toHaveTextContent("{}");
    expect(screen.queryByText(/No response headers were exposed/)).not.toBeInTheDocument();
  });

  it.each(["denied", "unavailable"])("surfaces %s clipboard access without claiming success", async (failure) => {
    if (failure === "denied") writeText.mockRejectedValueOnce(new Error("Permission denied"));
    else Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not copy:.*copy it manually/);
    expect(screen.queryByText("Copied to clipboard.")).not.toBeInTheDocument();
  });
});
