import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import LoginScreen from "@/app/(auth)/login";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

describe("login screen", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it("validates with the shared rules before calling the server", async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Enter your email or phone number")).toBeTruthy();
    expect(screen.getByText("Enter your password")).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows the server's message on wrong credentials, without saying which part was wrong", async () => {
    global.fetch = jest.fn(async () => ({ status: 401, ok: false, json: async () => ({ error: { code: "invalid_credentials", message: "Invalid email, phone or password." } }) })) as unknown as typeof fetch;
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId("login-identifier"), "someone@example.com");
    await fireEvent.changeText(screen.getByTestId("login-password"), "wrong-password");
    await fireEvent.press(screen.getByTestId("login-submit"));
    await waitFor(() => expect(screen.getByText("Invalid email, phone or password.")).toBeTruthy());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.test/api/mobile/v1/auth/login");
    expect(JSON.parse(init.body)).toMatchObject({ identifier: "someone@example.com", device: { platform: expect.any(String) } });
  });

  it("labels every control for screen readers", async () => {
    await render(<LoginScreen />);
    expect(screen.getByLabelText("Email or phone number")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
