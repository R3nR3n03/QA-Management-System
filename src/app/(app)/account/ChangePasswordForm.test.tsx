// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The server action is the enforcement boundary — the confirmation match it re-checks is
// covered where it lives. These tests are about what the form does before it is ever called.
vi.mock("./actions", () => ({ changePasswordAction: vi.fn(async () => null) }));

import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * The three masked fields and the two things a reader cannot otherwise see: what they typed,
 * and whether they typed it the same way twice.
 */

afterEach(cleanup);

const field = (name: string | RegExp) => screen.getByLabelText(name) as HTMLInputElement;

describe("ChangePasswordForm", () => {
  it("masks all three fields until each is revealed on its own", () => {
    render(<ChangePasswordForm minLength={8} />);

    expect(field("Current password").type).toBe("password");
    expect(field("New password").type).toBe("password");
    expect(field("Confirm new password").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

    // Only the one that was asked for. Three stacked password boxes and one reveal that
    // uncovered all of them would show two passwords to answer a question about one.
    expect(field("New password").type).toBe("text");
    expect(field("Current password").type).toBe("password");
    expect(field("Confirm new password").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Hide new password" }));
    expect(field("New password").type).toBe("password");
  });

  it("says nothing about the match until there is something to compare", () => {
    render(<ChangePasswordForm minLength={8} />);

    expect(screen.queryByText(/match/i)).toBeNull();

    fireEvent.change(field("New password"), { target: { value: "correct-horse" } });
    // The new password alone is not a comparison.
    expect(screen.queryByText(/match/i)).toBeNull();
  });

  it("reports agreement and disagreement as the confirmation is typed", () => {
    render(<ChangePasswordForm minLength={8} />);

    fireEvent.change(field("New password"), { target: { value: "correct-horse" } });
    fireEvent.change(field("Confirm new password"), { target: { value: "correct-h" } });
    expect(screen.getByText("These do not match yet.")).toBeTruthy();

    fireEvent.change(field("Confirm new password"), { target: { value: "correct-horse" } });
    expect(screen.getByText("Both entries match.")).toBeTruthy();
  });

  // The floor is a deployment default (`src/lib/password.ts`), not policy — so the copy and
  // the control both take it from the caller rather than restating 8.
  it("takes the minimum length from the server rather than naming its own", () => {
    render(<ChangePasswordForm minLength={12} />);

    expect(screen.getByText("At least 12 characters.")).toBeTruthy();
    expect(field("New password").minLength).toBe(12);
  });

  it("submits the confirmation, so the server can re-check the match without JavaScript", () => {
    render(<ChangePasswordForm minLength={8} />);

    expect(field("Current password").name).toBe("currentPassword");
    expect(field("New password").name).toBe("newPassword");
    expect(field("Confirm new password").name).toBe("confirmPassword");
  });
});
