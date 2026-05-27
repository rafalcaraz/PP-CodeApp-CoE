/**
 * Smoke test for the DLP Duplicator view.
 *
 * Renders the view inside FluentProvider with `data/dlpPolicies` and
 * `data/inventory` mocked. Asserts:
 *   1. The view loads, the source-policy picker is reachable, and the
 *      env list renders the mocked environments.
 *   2. The "Duplicate" button is disabled until both a source AND at
 *      least one environment are selected — the page's core safety
 *      contract.
 *   3. Clicking duplicate calls `createDlpPolicy` with a body built
 *      from `buildDuplicatePolicyBody`. We don't assert the full body
 *      shape here (the builder's own tests pin that); we only confirm
 *      the call happens with the expected source + new name + env.
 *
 * Follows the same mock-the-data-layer-then-import pattern as
 * `features/agents/AgentsList.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { PolicyV2 } from "../../generated/models/PowerPlatformforAdminsModel";
import type { EnvironmentRow } from "../../data/inventory";

// vi.hoisted lets us share constants with the vi.mock factories below.
// Without it, the factory body sees ReferenceErrors because vi.mock is
// hoisted above the module's top-level declarations.
const {
  SOURCE_POLICY,
  ENV_A,
  createDlpPolicyMock,
  listDlpPoliciesMock,
  listEnvironmentsMock,
} = vi.hoisted(() => {
  const SOURCE_POLICY = {
    name: "src-policy",
    displayName: "Source DLP Policy",
    defaultConnectorsClassification: "General",
    connectorGroups: [
      {
        classification: "Confidential",
        connectors: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_office365",
            name: "shared_office365",
            _type: "Microsoft.PowerApps/apis",
          },
        ],
      },
    ],
    environmentType: "AllEnvironments",
    environments: [],
    createdBy: {},
    createdTime: "",
    lastModifiedBy: {},
    lastModifiedTime: "",
    isLegacySchemaVersion: false,
  };
  const ENV_A = {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Contoso Prod",
    environmentType: "Production",
    region: "unitedstates",
    isManaged: false,
    createdAt: "",
    createdBy: "",
    lastModifiedAt: "",
    environmentGroupId: "",
    environmentGroup: "",
  };
  return {
    SOURCE_POLICY,
    ENV_A,
    createDlpPolicyMock: vi.fn(),
    listDlpPoliciesMock: vi.fn(),
    listEnvironmentsMock: vi.fn(),
  };
});

vi.mock("../../data/dlpPolicies", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/dlpPolicies")
  >("../../data/dlpPolicies");
  return {
    ...actual,
    listDlpPolicies: listDlpPoliciesMock,
    createDlpPolicy: createDlpPolicyMock,
  };
});

vi.mock("../../data/inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/inventory")
  >("../../data/inventory");
  return {
    ...actual,
    listEnvironments: listEnvironmentsMock,
  };
});

import { DlpDuplicator } from "./DlpDuplicator";

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <DlpDuplicator />
    </FluentProvider>,
  );
}

describe("DlpDuplicator smoke", () => {
  beforeEach(() => {
    listDlpPoliciesMock.mockReset();
    listEnvironmentsMock.mockReset();
    createDlpPolicyMock.mockReset();
    listDlpPoliciesMock.mockResolvedValue({
      ok: true,
      data: [SOURCE_POLICY as unknown as PolicyV2],
    });
    listEnvironmentsMock.mockResolvedValue({
      ok: true,
      data: [ENV_A as unknown as EnvironmentRow],
    });
    createDlpPolicyMock.mockResolvedValue({
      ok: true,
      data: {
        ...(SOURCE_POLICY as unknown as PolicyV2),
        name: "new-policy",
        displayName: "Copy",
      },
    });
  });

  it("renders the source picker and environment list from the mocked data layers", async () => {
    renderView();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Choose a policy to duplicate…"),
      ).toBeInTheDocument();
      expect(screen.getByText(/Contoso Prod/)).toBeInTheDocument();
    });
  });

  it("keeps Duplicate disabled until both source and an environment are picked", async () => {
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/Contoso Prod/)).toBeInTheDocument();
    });

    const duplicateBtn = screen.getByRole("button", { name: /duplicate policy/i });
    expect(duplicateBtn).toBeDisabled();

    // Pick the env first; source is still unset → button stays disabled.
    const envCheckbox = screen.getByRole("checkbox", { name: /Contoso Prod/ });
    fireEvent.click(envCheckbox);
    expect(duplicateBtn).toBeDisabled();
  });

  it("calls createDlpPolicy when source, name and env are all set", async () => {
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/Contoso Prod/)).toBeInTheDocument();
    });

    // Pick the source via the Combobox option (it renders the policy
    // displayName inside an Option element).
    const combo = screen.getByPlaceholderText("Choose a policy to duplicate…");
    fireEvent.click(combo);
    const option = await screen.findByRole("option", {
      name: /Source DLP Policy/,
    });
    fireEvent.click(option);

    // Pick the env.
    const envCheckbox = screen.getByRole("checkbox", { name: /Contoso Prod/ });
    fireEvent.click(envCheckbox);

    const duplicateBtn = screen.getByRole("button", { name: /duplicate policy/i });
    await waitFor(() => expect(duplicateBtn).toBeEnabled());

    fireEvent.click(duplicateBtn);

    await waitFor(() => {
      expect(createDlpPolicyMock).toHaveBeenCalledTimes(1);
    });
    const body = createDlpPolicyMock.mock.calls[0][0];
    expect(body.displayName).toMatch(/Copy of Source DLP Policy/);
    expect(body.environmentType).toBe("OnlyEnvironments");
    expect(body.environments).toHaveLength(1);
    expect(body.environments[0].name).toBe(ENV_A.id);
  });
});
