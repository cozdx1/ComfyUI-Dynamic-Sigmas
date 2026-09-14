class DynamicInputDict(dict):
    def __init__(self, base_dict, default_type=("SIGMAS",), key_prefix=None):
        super().__init__(base_dict)
        self.default_type = default_type
        self.key_prefix = key_prefix

    def __contains__(self, key):
        return super().__contains__(key) or (
            isinstance(key, str)
            and self.key_prefix is not None
            and key.startswith(self.key_prefix)
            and key[len(self.key_prefix) :].isdigit()
        )

    def __getitem__(self, key):
        if super().__contains__(key):
            return super().__getitem__(key)
        if key in self:
            return self.default_type
        raise KeyError(key)


class DynamicReturnType(tuple):
    def __new__(cls, base_tuple, default_type="IMAGE", max_len=100):
        instance = super().__new__(cls, base_tuple)
        instance.default_type = default_type
        instance.max_len = max_len
        return instance

    def __len__(self):
        return self.max_len

    def __getitem__(self, index):
        if index < super().__len__():
            return super().__getitem__(index)
        return self.default_type

class DynamicReturnNames(tuple):
    def __new__(cls, base_tuple, prefix="IMAGE_", max_len=100):
        instance = super().__new__(cls, base_tuple)
        instance.prefix = prefix
        instance.max_len = max_len
        return instance

    def __len__(self):
        return self.max_len

    def __getitem__(self, index):
        if index < super().__len__():
            return super().__getitem__(index)
        return f"{self.prefix}{index + 1}"
