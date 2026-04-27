import { Toaster, toast, type ToastOptions } from "react-hot-toast";

const TOAST_STYLE: ToastOptions["style"] = {
    borderRadius: 10,
    border: "1px solid var(--pg-border)",
    background: "var(--pg-surface-1)",
    color: "var(--pg-text)",
    boxShadow: "0 14px 30px rgba(2, 6, 23, 0.42)",
    fontSize: 13,
    maxWidth: 420,
};

const TOAST_OPTIONS: ToastOptions = {
    duration: 2800,
    style: TOAST_STYLE,
};

export function AppToaster() {
    return (
        <Toaster
            position="bottom-right"
            gutter={10}
            toastOptions={TOAST_OPTIONS}
            containerStyle={{
                bottom: 18,
                right: 18,
            }}
        />
    );
}

export function notifySuccess(message: string): string {
    return toast.success(message, {
        duration: 2400,
        iconTheme: {
            primary: "var(--pg-primary-soft)",
            secondary: "var(--pg-surface-1)",
        },
    });
}

export function notifyError(message: string): string {
    return toast.error(message, {
        duration: 3600,
        iconTheme: {
            primary: "var(--pg-danger)",
            secondary: "var(--pg-surface-1)",
        },
    });
}

export function notifyInfo(message: string): string {
    return toast(message, { duration: 2600 });
}

export function notifyLoading(message: string): string {
    return toast.loading(message);
}

export function notifyDismiss(toastId?: string) {
    if (toastId) {
        toast.dismiss(toastId);
        return;
    }
    toast.dismiss();
}
