// Copyright 2024 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useAtom } from "jotai";
import { useResetState } from "./hooks";
import {
  ModelSelectedAtom,
  ShowConfigAtom,
} from "./atoms";
import { modelOptions } from "./consts";

interface TopBarProps {
  title?: string;
}

export function TopBar({ title = "Visual Navigator for the Blind" }: TopBarProps) {
  const resetState = useResetState();
  const [modelSelected, setModelSelected] = useAtom(ModelSelectedAtom);
  const [showConfig] = useAtom(ShowConfigAtom);

  return (
    <div className="flex w-full items-center px-3 py-3 border-b justify-between bg-[#3B68FF] text-white">
      <div className="flex gap-3 items-center">
        <h1 className="font-bold">{title}</h1>
      </div>
      <div className="flex gap-3 items-center">
        {showConfig && (
          <label className="flex gap-2 items-center">
            <select
              className="border bg-transparent py-1 px-1 focus:border-white rounded-md text-white"
              value={modelSelected}
              onChange={(e) => {
                const value = e.target.value;
                setModelSelected(value);
              }}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() => {
            resetState();
          }}
          className="p-1 px-2 border border-white rounded bg-transparent hover:bg-white hover:text-[#3B68FF] transition-colors"
        >
          <div>Reset</div>
        </button>
      </div>
    </div>
  );
}
