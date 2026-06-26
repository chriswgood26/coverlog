"use client";

export function DisableButton() {
  return (
    <button
      type="submit"
      className="text-red-500 hover:text-red-600 text-sm font-medium"
      onClick={(e) => {
        if (!window.confirm("Disable this organization? Its staff will lose access to the app until it's re-enabled.")) {
          e.preventDefault();
        }
      }}
    >
      Disable
    </button>
  );
}
