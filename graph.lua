local types = {
    { 0, true, 7, false },
    { -7, true, 7, false },
    { 0, true, 8, false },
    { 0, true, 15, false },
    { -15, true, 15, false },
    { 0, true, 16, false },
    { 0, true, 24, false },
    { -24, true, 24, false },
    { -24, false, 24, true },
    { 0, true, 31, false },
    { -31, true, 31, false },
    { 0, true, 32, false },
    { 0, false, 53, true },
    { -53, true, 53, false },
    { -53, false, 53, true },
    { 0, true, 63, false },
    { -63, true, 63, false },
    { 0, true, 64, false },
}

local function typeToString(t)
    if t[1] == 0 then
        return "u" .. t[3]
    elseif -t[1] == t[3] then
        if t[4] then
            if t[3] == 53 then
                return "f64"
            elseif t[3] == 24 then
                return "f32"
            end
        else
            return "i" .. (t[3] + 1)
        end
    else
        return t[1] .. "..=" .. t[3]
    end
end

local function coerce(s, t)
    return ((s[2] or not t[2]) and s[1] >= t[1] or s[1] > t[1]) and s[3] <= t[3] and (not s[4] or t[4]) -- sorry
end

print(#types)
for i, v in pairs(types) do
    local id = string.rep("0", #types - i) .. "1" .. string.rep("0", i - 1)
    local from = ""
    for k, o in pairs(types) do
        from = from .. (coerce(o, v) and "1" or "0")
    end
    print(typeToString(v), "0b" .. from .. id)
end
