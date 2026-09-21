export type NotchKind = 'island' | 'notch' | 'hole' | 'none';

export interface DevicePreset {
    id: string;
    label: string;
    group: 'iPhone' | 'iPad' | 'Android';
    /** Portrait CSS pixels — the viewport the playable actually sees. */
    width: number;
    height: number;
    notch: NotchKind;
    homeIndicator: boolean;
    bezel: number;
    radius: number;
}

export const DEVICES: DevicePreset[] = [
    { id: 'iphone-se', label: 'iPhone SE', group: 'iPhone', width: 375, height: 667, notch: 'none', homeIndicator: false, bezel: 18, radius: 30 },
    { id: 'iphone-13-mini', label: 'iPhone 13 mini', group: 'iPhone', width: 375, height: 812, notch: 'notch', homeIndicator: true, bezel: 12, radius: 44 },
    { id: 'iphone-14', label: 'iPhone 14', group: 'iPhone', width: 390, height: 844, notch: 'notch', homeIndicator: true, bezel: 12, radius: 46 },
    { id: 'iphone-15-pro', label: 'iPhone 15 Pro', group: 'iPhone', width: 393, height: 852, notch: 'island', homeIndicator: true, bezel: 11, radius: 48 },
    { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', group: 'iPhone', width: 430, height: 932, notch: 'island', homeIndicator: true, bezel: 11, radius: 50 },
    { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', group: 'iPhone', width: 440, height: 956, notch: 'island', homeIndicator: true, bezel: 11, radius: 52 },
    { id: 'ipad-mini', label: 'iPad mini', group: 'iPad', width: 744, height: 1133, notch: 'none', homeIndicator: true, bezel: 20, radius: 34 },
    { id: 'ipad-air-11', label: 'iPad Air 11"', group: 'iPad', width: 820, height: 1180, notch: 'none', homeIndicator: true, bezel: 22, radius: 30 },
    { id: 'ipad-pro-11', label: 'iPad Pro 11"', group: 'iPad', width: 834, height: 1194, notch: 'none', homeIndicator: true, bezel: 20, radius: 34 },
    { id: 'ipad-pro-13', label: 'iPad Pro 12.9"', group: 'iPad', width: 1024, height: 1366, notch: 'none', homeIndicator: true, bezel: 22, radius: 32 },
    { id: 'pixel-7', label: 'Pixel 7', group: 'Android', width: 412, height: 915, notch: 'hole', homeIndicator: true, bezel: 12, radius: 40 },
    { id: 'galaxy-s22', label: 'Galaxy S22', group: 'Android', width: 360, height: 800, notch: 'hole', homeIndicator: true, bezel: 11, radius: 38 },
    { id: 'galaxy-tab-s8', label: 'Galaxy Tab S8', group: 'Android', width: 800, height: 1280, notch: 'none', homeIndicator: true, bezel: 20, radius: 26 },
];

export const DEFAULT_DEVICE = DEVICES.find((device) => device.id === 'iphone-15-pro')!;

export type Orientation = 'portrait' | 'landscape';

export function deviceSize(device: DevicePreset, orientation: Orientation): { width: number; height: number } {
    return orientation === 'portrait'
        ? { width: device.width, height: device.height }
        : { width: device.height, height: device.width };
}

export const RESPONSIVE_PRESETS = [
    { label: '320 × 568', width: 320, height: 568 },
    { label: '360 × 640', width: 360, height: 640 },
    { label: '414 × 896', width: 414, height: 896 },
    { label: '768 × 1024', width: 768, height: 1024 },
    { label: '1280 × 720', width: 1280, height: 720 },
];
