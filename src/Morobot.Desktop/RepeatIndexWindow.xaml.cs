using System.Windows;
using Morobot.Desktop.Models;

namespace Morobot.Desktop;

/// <summary>
/// Asks which iteration indices to run.
/// </summary>
/// <remarks>
/// Only shown when a process actually iterates more than once: asking "which rows?" for a process
/// that has one row is a question with a single answer, and the extension behaves the same way.
/// </remarks>
public partial class RepeatIndexWindow : Window
{
    public List<int> SelectedIndices { get; private set; } = new();

    public RepeatIndexWindow(int totalRows)
    {
        InitializeComponent();
        for (var i = 0; i < totalRows; i++)
            IndexList.Items.Add(new IndexItem(i, $"اندیس {i + 1}"));
        // Everything selected by default: "run the process" usually means "run it all", and the
        // user narrows it down rather than building it up.
        IndexList.SelectAll();
    }

    private void All_Click(object sender, RoutedEventArgs e) => IndexList.SelectAll();

    private void None_Click(object sender, RoutedEventArgs e) => IndexList.UnselectAll();

    private void Start_Click(object sender, RoutedEventArgs e)
    {
        var picked = IndexList.SelectedItems.Cast<IndexItem>().Select(i => i.Index).OrderBy(i => i).ToList();
        if (picked.Count == 0)
        {
            MessageBox.Show(this, "حداقل یک اندیس انتخاب کنید.", "انتخاب اندیس تکرار",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        SelectedIndices = picked;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    public sealed record IndexItem(int Index, string Label)
    {
        public override string ToString() => Label;
    }
}
