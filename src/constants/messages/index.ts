import { MESSAGES as tr } from "./tr";
import { MESSAGES as en } from "./en";

export type SupportedLanguage = "tr" | "en";

export const MESSAGES = tr;

export const getMessages = (lang?: string) => {
    if (lang && lang.toLowerCase().startsWith("en")) {
        return en;
    }
    return tr;
};

// Build a dictionary of string mappings from TR -> EN
const TR_TO_EN = new Map<string, string>();

const buildDictionary = (trObj: any, enObj: any) => {
    if (!trObj || !enObj) return;
    for (const key of Object.keys(trObj)) {
        const trVal = trObj[key];
        const enVal = enObj[key];
        if (typeof trVal === "string" && typeof enVal === "string") {
            TR_TO_EN.set(trVal, enVal);
        } else if (typeof trVal === "object" && typeof enVal === "object") {
            buildDictionary(trVal, enVal);
        }
    }
};

buildDictionary(tr, en);

export const translateMessage = (message: string, lang?: string): string => {
    if (!message || !lang || !lang.toLowerCase().startsWith("en")) {
        return message;
    }

    // Direct dictionary lookup
    if (TR_TO_EN.has(message)) {
        return TR_TO_EN.get(message)!;
    }

    // Dynamic patterns
    const oauthNoPasswordMatch = message.match(
        /^Bu hesap (.+) ile oluşturulmuş\. Lütfen (.+) ile giriş yapın veya bir şifre belirlemek için 'Şifremi Unuttum' adımını kullanın\.$/,
    );
    if (oauthNoPasswordMatch) {
        return en.ERRORS.OAUTH_ACCOUNT_NO_PASSWORD(oauthNoPasswordMatch[1]);
    }

    const usernameLimitMatch = message.match(/Kullanıcı adınızı 14 günde bir değiştirebilirsiniz\. Kalan gün: (\d+)/);
    if (usernameLimitMatch) {
        return en.ERRORS.USERNAME_CHANGE_LIMIT(Number(usernameLimitMatch[1]));
    }

    const requiredMatch = message.match(/^(.+) alanı zorunludur\.$/);
    if (requiredMatch) {
        return `${requiredMatch[1]} is required.`;
    }

    const minLengthMatch = message.match(/^(.+) en az (\d+) karakter olmalıdır\.$/);
    if (minLengthMatch) {
        return `${minLengthMatch[1]} must be at least ${minLengthMatch[2]} characters.`;
    }

    const maxLengthMatch = message.match(/^(.+) en fazla (\d+) karakter olabilir\.$/);
    if (maxLengthMatch) {
        return `${maxLengthMatch[1]} must be at most ${maxLengthMatch[2]} characters.`;
    }

    const invalidFormatMatch = message.match(/^Geçersiz (.+) formatı\.$/);
    if (invalidFormatMatch) {
        return `Invalid ${invalidFormatMatch[1]} format.`;
    }

    return message;
};
