"use client";

export function DisableButton() {
  return (
    <button
      type="submit"
      className="text-red-500 hover:text-red-600 text-sm font-medium"
      onClick={(e) => {
        if (!window.confirm("Disable this organization? Its staff will be locked out until re-enabled.")) {
          e.preventDefault();
        }
      }}
    >
      Disable
    </button>
  );
}
